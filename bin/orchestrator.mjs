#!/usr/bin/env node
/**
 * Local helpers for the autonomous orchestration protocol.
 *
 *   node orchestrator.mjs inventory [--repo <path>] [--json]
 *   node orchestrator.mjs resources [--repo <path>] [--json]
 *
 * `inventory` reads `git worktree list --porcelain` and adds the facts the protocol asks for:
 * dirtiness, distance from the base branch, whether the head commit is on the remote, the upstream
 * and a classification. It is read-only: every git call is an inspection command.
 *
 * `resources` reports free memory, CPU load, core count and free disk for the repository's drive,
 * with an advisory level. Advisory only: OpenCode has no global job scheduler, so this measures, it
 * does not enforce.
 *
 * Exit codes: 0 success, 2 usage error, 3 git could not answer for the repository.
 *
 * No dependencies; Node 20+ (uses fs.statfsSync).
 */
import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GB = 1024 ** 3;

/* ------------------------------------------------------------------------------------------------ */
/* Pure parsers and rules (unit-tested in orchestrator.test.mjs)                                     */
/* ------------------------------------------------------------------------------------------------ */

/** Parses `git worktree list --porcelain` into one object per worktree. */
export function parseWorktrees(porcelain) {
  const out = [];
  let current = null;
  for (const raw of porcelain.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("worktree ")) {
      if (current) out.push(current);
      current = {
        path: line.slice("worktree ".length),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: null,
        prunable: null,
      };
      continue;
    }
    if (!current || line === "") continue;
    if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("locked")) current.locked = line.slice(6).trim() || "(locked)";
    else if (line.startsWith("prunable")) current.prunable = line.slice(8).trim() || "(prunable)";
  }
  if (current) out.push(current);
  return out;
}

/** Counts staged, unstaged and untracked entries in `git status --porcelain` output. */
export function parseStatus(porcelain) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("??")) {
      untracked += 1;
      continue;
    }
    if (line.startsWith("!!")) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x !== " " && x !== "?") staged += 1;
    if (y !== " ") unstaged += 1;
  }
  return { staged, unstaged, untracked, dirty: staged + unstaged + untracked > 0 };
}

/** Parses `git rev-list --left-right --count A...B`, which prints "left right". */
export function parseCountPair(text) {
  const match = /(\d+)\s+(\d+)/.exec(text ?? "");
  return match ? { left: Number(match[1]), right: Number(match[2]) } : { left: 0, right: 0 };
}

/**
 * One classification per worktree, in the order that matters for preservation: a missing worktree
 * or a locked one is reported before anything else, then uncommitted work, then where the branch
 * stands relative to the base and the remote.
 */
export function classify(state) {
  const {
    prunable = null,
    bare = false,
    locked = null,
    detached = false,
    dirty = false,
    branch = null,
    headOnRemote = false,
    mergedIntoBase = false,
    aheadOfRemote = 0,
  } = state ?? {};
  if (prunable) return "prunable";
  if (bare) return "bare";
  if (locked) return "protected";
  if (dirty) return "uncommitted";
  if (detached) return "detached";
  if (!branch) return "unknown";
  if (mergedIntoBase && headOnRemote) return "integrated";
  if (!headOnRemote) return "local-only";
  if (aheadOfRemote > 0) return "unpushed";
  return "ready";
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * Advisory scheduling level from measured numbers. RAM is total capacity; the thresholds are for the
 * free memory left once the OS, editors and servers have taken theirs. Null means "could not
 * measure" and never counts as a problem.
 */
export function resourceAdvice({
  freeMemGb = null,
  totalMemGb = null,
  cpuCount = 1,
  loadPct = null,
  freeDiskGb = null,
} = {}) {
  const reasons = [];
  let level = "green";
  const raise = (next) => {
    if (next === "red" || (next === "amber" && level === "green")) level = next;
  };

  if (freeMemGb !== null && freeMemGb < 2) {
    raise("red");
    reasons.push(`${round(freeMemGb)} GB free memory`);
  } else if (freeMemGb !== null && freeMemGb < 5) {
    raise("amber");
    reasons.push(`${round(freeMemGb)} GB free memory`);
  }
  if (freeDiskGb !== null && freeDiskGb < 2) {
    raise("red");
    reasons.push(`${round(freeDiskGb)} GB free disk`);
  } else if (freeDiskGb !== null && freeDiskGb < 10) {
    raise("amber");
    reasons.push(`${round(freeDiskGb)} GB free disk`);
  }
  if (loadPct !== null && loadPct >= 85) {
    raise("red");
    reasons.push(`CPU load ${Math.round(loadPct)}%`);
  } else if (loadPct !== null && loadPct >= 60) {
    raise("amber");
    reasons.push(`CPU load ${Math.round(loadPct)}%`);
  }

  const cores = Math.max(1, cpuCount ?? 1);
  const heavySlots = level === "red" ? 0 : level === "amber" ? 1 : Math.max(1, Math.min(2, Math.floor(cores / 4)));
  const moderateSlots = level === "red" ? 1 : level === "amber" ? 2 : Math.max(2, Math.min(4, Math.floor(cores / 2)));
  const advice =
    level === "red"
      ? "Under pressure: light work only, or wait. Do not start a build, install or browser suite."
      : level === "amber"
        ? "Tight: one heavy job at a time, two moderate, light work in parallel."
        : "Headroom: up to two heavy jobs, three or four moderate, light work in parallel.";

  return {
    level,
    heavySlots,
    moderateSlots,
    reasons,
    advice,
    measured: {
      freeMemGb: freeMemGb === null ? null : round(freeMemGb),
      totalMemGb: totalMemGb === null ? null : round(totalMemGb),
      cpuCount: cpuCount ?? null,
      loadPct: loadPct === null ? null : Math.round(loadPct),
      freeDiskGb: freeDiskGb === null ? null : round(freeDiskGb),
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Imperative side: reading git and the machine                                                     */
/* ------------------------------------------------------------------------------------------------ */

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** Reads every local worktree of the repository that contains `repoPath`. Read-only. */
export function inventory(repoPath = process.cwd()) {
  const root = tryGit(repoPath, ["rev-parse", "--show-toplevel"]) ?? path.resolve(repoPath);
  const porcelain = tryGit(root, ["worktree", "list", "--porcelain"]);
  if (porcelain === null) throw new Error(`Not a git repository: ${root}`);

  const base =
    ["origin/develop", "origin/main", "develop", "main"].find(
      (candidate) => tryGit(root, ["rev-parse", "--verify", "--quiet", candidate]) !== null,
    ) ?? null;

  const remoteHeads = new Map();
  const lsRemote = tryGit(root, ["ls-remote", "--heads", "origin"]);
  if (lsRemote) {
    for (const line of lsRemote.split(/\r?\n/)) {
      const [sha, ref] = line.split(/\s+/);
      if (sha && ref) remoteHeads.set(ref.replace("refs/heads/", ""), sha);
    }
  }

  const worktrees = parseWorktrees(porcelain).map((worktree) => {
    if (worktree.bare) {
      return {
        ...worktree,
        status: null,
        vsBase: null,
        upstream: null,
        subject: null,
        headOnRemote: false,
        classification: classify(worktree),
      };
    }

    const statusText = tryGit(worktree.path, ["status", "--porcelain"]);
    const status = statusText === null ? null : parseStatus(statusText);

    let vsBase = null;
    if (base && worktree.head) {
      const pair = parseCountPair(
        tryGit(worktree.path, ["rev-list", "--left-right", "--count", `${base}...${worktree.head}`]) ?? "",
      );
      vsBase = { ahead: pair.right, behind: pair.left };
    }

    const upstreamName =
      tryGit(worktree.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) ?? null;
    let upstream = null;
    if (upstreamName) {
      const pair = parseCountPair(
        tryGit(worktree.path, ["rev-list", "--left-right", "--count", `${upstreamName}...HEAD`]) ?? "",
      );
      upstream = { name: upstreamName, ahead: pair.right, behind: pair.left };
    }

    const headOnRemote = worktree.branch ? remoteHeads.get(worktree.branch) === worktree.head : false;
    const mergedIntoBase =
      base && worktree.head
        ? tryGit(root, ["merge-base", "--is-ancestor", worktree.head, base]) !== null
        : false;

    return {
      ...worktree,
      status,
      vsBase,
      upstream,
      subject: tryGit(worktree.path, ["log", "-1", "--format=%s"]) ?? null,
      headOnRemote,
      classification: classify({
        ...worktree,
        dirty: status?.dirty ?? false,
        headOnRemote,
        mergedIntoBase,
        aheadOfRemote: upstream?.ahead ?? 0,
      }),
    };
  });

  return { root, base, worktrees };
}

/** Reads memory, CPU and disk. Every measurement may be null on a platform that refuses it. */
export function readResources(repoPath = process.cwd()) {
  const totalMemGb = os.totalmem() / GB;
  const freeMemGb = os.freemem() / GB;
  const cpuCount = os.cpus().length;

  let loadPct = null;
  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average",
        ],
        { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
      );
      const parsed = Number.parseFloat(out.trim());
      if (Number.isFinite(parsed)) loadPct = Math.max(0, Math.min(100, parsed));
    } catch {
      loadPct = null;
    }
  } else {
    const load = os.loadavg()[0];
    if (Number.isFinite(load) && cpuCount > 0) loadPct = Math.max(0, Math.min(100, (load / cpuCount) * 100));
  }

  let freeDiskGb = null;
  try {
    const stats = statfsSync(repoPath);
    freeDiskGb = (stats.bavail * stats.bsize) / GB;
  } catch {
    freeDiskGb = null;
  }

  return { totalMemGb, freeMemGb, cpuCount, loadPct, freeDiskGb };
}

/* ------------------------------------------------------------------------------------------------ */
/* Output                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

function cell(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function printInventory(result) {
  console.log(`repository: ${result.root}`);
  console.log(`base:       ${result.base ?? "(none of origin/develop, origin/main, develop, main)"}`);
  console.log("");
  console.log("| class | branch | head | changes | vs base | upstream | remote | worktree |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const worktree of result.worktrees) {
    const changes = worktree.status
      ? `${worktree.status.staged}/${worktree.status.unstaged}/${worktree.status.untracked}`
      : "unreadable";
    const vsBase = worktree.vsBase ? `+${worktree.vsBase.ahead} / -${worktree.vsBase.behind}` : "-";
    const upstream = worktree.upstream
      ? `${worktree.upstream.name} +${worktree.upstream.ahead}`
      : "-";
    console.log(
      `| ${worktree.classification} | ${cell(worktree.branch ?? (worktree.detached ? "(detached)" : null))} | ${cell(worktree.head?.slice(0, 7))} | ${changes} | ${vsBase} | ${upstream} | ${worktree.headOnRemote ? "yes" : "no"} | ${worktree.path} |`,
    );
  }
  const counts = result.worktrees.reduce((acc, worktree) => {
    acc[worktree.classification] = (acc[worktree.classification] ?? 0) + 1;
    return acc;
  }, {});
  console.log("");
  console.log(
    `summary: ${Object.entries(counts)
      .map(([name, count]) => `${count} ${name}`)
      .join(", ")}`,
  );
  console.log("changes are staged/unstaged/untracked. Read-only: nothing was modified.");
}

function printResources(result) {
  console.log(`memory:  ${round(result.freeMemGb)} GB free of ${round(result.totalMemGb)} GB`);
  console.log(
    `CPU:     ${result.cpuCount} cores${result.loadPct === null ? "" : `, load ${Math.round(result.loadPct)}%`}`,
  );
  console.log(
    `disk:    ${result.freeDiskGb === null ? "unavailable" : `${round(result.freeDiskGb)} GB free on the repository drive`}`,
  );
  console.log("");
  console.log(`level:   ${result.level}`);
  console.log(`slots:   ${result.heavySlots} heavy, ${result.moderateSlots} moderate (advisory)`);
  console.log(`advice:  ${result.advice}`);
  if (result.reasons.length > 0) console.log(`reasons: ${result.reasons.join("; ")}`);
  console.log("");
  console.log("Advisory only: OpenCode has no global scheduler, so nothing here is enforced.");
}

/* ------------------------------------------------------------------------------------------------ */
/* CLI                                                                                              */
/* ------------------------------------------------------------------------------------------------ */

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const wantJson = argv.includes("--json");
  const repo = readArg(argv, "--repo") ?? process.cwd();

  try {
    if (command === "inventory") {
      const result = inventory(repo);
      if (wantJson) console.log(JSON.stringify(result, null, 2));
      else printInventory(result);
      return;
    }
    if (command === "resources") {
      const result = { ...readResources(repo) };
      const advice = resourceAdvice(result);
      const combined = { ...advice, ...result };
      if (wantJson) console.log(JSON.stringify(combined, null, 2));
      else printResources(combined);
      return;
    }
    console.error("usage: node orchestrator.mjs <inventory|resources> [--repo <path>] [--json]");
    process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
