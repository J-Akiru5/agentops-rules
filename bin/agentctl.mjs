#!/usr/bin/env node
/**
 * agentctl — the single operational interface for the AgentOps planning backbone.
 *
 * Plan (intent)   : read from a Git ref (origin/develop by default), never a stale checkout.
 * State (runtime) : <git-common-dir>/agentops/state.db (SQLite, shared by every worktree).
 * Evidence        : tool-produced rows keyed by tree SHA; logs beside the database.
 *
 * Run `agentctl help` for the command list.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { integrateTask } from "./agentops/integrator.mjs";
import { databaseStatus, runDevelopmentMigration } from "./agentops/dbplane.mjs";
import {
  deploymentContractIssues,
  diffContracts,
  globsMayOverlap,
  loadPlan,
  matchesAny,
  parseAcceptance,
  resolvePlanSource,
  scopeViolations,
} from "./agentops/planlib.mjs";
import { Refusal, ResourceDeferral, measure, runProfile } from "./agentops/runner.mjs";
import {
  ackContract,
  ackStatus,
  acquireLock,
  addSeconds,
  appendJournal,
  claimTask,
  getAgent,
  getTask,
  latestEvidence,
  listAgents,
  listTasks,
  nowIso,
  openState,
  recordEvent,
  registerAgent,
  releaseClaim,
  releaseLock,
  renewClaim,
  requireOwner,
  StateRefusal,
  tx,
  updateTask,
  upsertTaskFromContract,
  reapExpired,
} from "./agentops/state.mjs";
import { parseFrontmatter } from "./agentops/yaml.mjs";
import { inventory } from "./orchestrator.mjs";

const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, ANOMALY: 4 };

/* ------------------------------------------------------------------ helpers */

function usageError(message) {
  const error = new Error(message);
  error.name = "UsageError";
  return error;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-m") {
      flags.message = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=");
      if (inline !== undefined) {
        flags[name] = inline;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && next !== "-m") {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function repoRoot(requested) {
  const base = path.resolve(requested ?? process.cwd());
  const root = tryGit(base, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new UsageError(`not inside a Git repository: ${base}`);
  return root;
}

function currentBranch(repo) {
  return tryGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "(detached)";
}

function headSha(repo) {
  return git(repo, ["rev-parse", "HEAD"]);
}

function treeSha(repo, ref = "HEAD") {
  return git(repo, ["rev-parse", `${ref}^{tree}`]);
}

function isClean(repo) {
  return git(repo, ["status", "--porcelain"]) === "";
}

function agentOf(flags, { required = true } = {}) {
  const agent = flags.agent ?? process.env.AGENT_ID ?? null;
  if (!agent && required) throw new UsageError("agent identity required: pass --agent <id> or set AGENT_ID");
  return agent;
}

function resolvePlan(repo, flags) {
  return loadPlan(repo, { source: flags["plan-source"] ?? "auto" });
}

function failPlan(plan) {
  if (plan.errors.length > 0) {
    throw new Refusal(`plan validation failed:\n${plan.errors.map((entry) => `  - ${entry}`).join("\n")}`);
  }
}

function taskRow(db, id) {
  const row = getTask(db, id);
  if (!row) throw new Refusal(`task ${id} is not in the state database; run "agentctl plan sync"`);
  return row;
}

function findContract(plan, id) {
  const entry = plan.tasks.find((task) => task.meta?.id === id);
  if (!entry) throw new Refusal(`contract ${id} not found in plan source ${plan.source.label}`);
  return entry;
}

function print(value, json, fallback) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(fallback ?? JSON.stringify(value, null, 2));
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function ownershipOverlaps(db, taskId, ownership) {
  const now = nowIso();
  const rows = db
    .prepare(
      `SELECT c.task_id, t.ownership FROM claims c JOIN tasks t ON t.id = c.task_id
       WHERE c.released_at IS NULL AND c.expires_at > ? AND c.task_id != ?`,
    )
    .all(now, taskId);
  const overlaps = [];
  for (const row of rows) {
    let other = [];
    try {
      other = JSON.parse(row.ownership ?? "[]");
    } catch {
      other = [];
    }
    for (const mine of ownership ?? []) {
      for (const theirs of other) {
        if (globsMayOverlap(mine, theirs)) {
          overlaps.push({ task: row.task_id, mine, theirs });
        }
      }
    }
  }
  return overlaps;
}

function planFileRead(repo, sourceSpec, relPath) {
  const source = resolvePlanSource(repo, sourceSpec ?? "auto");
  if (source.kind === "worktree") return fs.readFileSync(path.join(repo, relPath), "utf8");
  return execFileSync("git", ["-C", repo, "show", `${source.ref}:${relPath}`], { encoding: "utf8" });
}

function contractRevInWorktree(repo, contractFile) {
  const full = path.join(repo, contractFile);
  if (!fs.existsSync(full)) return null;
  try {
    const { meta } = parseFrontmatter(fs.readFileSync(full, "utf8"), { source: contractFile });
    return Number(meta.rev);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- commands */

function cmdAgent(ctx) {
  const { db, args } = ctx;
  const sub = args.positional[1];
  if (sub === "register") {
    const id = args.flags.id ?? args.positional[2];
    const role = args.flags.role;
    if (!id || !role) throw new UsageError("usage: agentctl agent register --id <id> --role <implementer|lead|reviewer|integrator>");
    if (!["implementer", "lead", "reviewer", "integrator"].includes(role)) {
      throw new UsageError("role must be implementer, lead, reviewer or integrator");
    }
    const agent = registerAgent(db, id, role);
    print(agent, args.flags.json, `registered ${agent.id} as ${agent.role}`);
    return EXIT.OK;
  }
  if (sub === "list") {
    const agents = listAgents(db);
    print(agents, args.flags.json, agents.map((agent) => `${agent.id}  ${agent.role}`).join("\n") || "(none)");
    return EXIT.OK;
  }
  throw new UsageError("usage: agentctl agent <register|list>");
}

function cmdPlan(ctx) {
  const { repo, db, args } = ctx;
  const sub = args.positional[1];
  if (sub === "sync") {
    if (!args.flags.offline) {
      try {
        git(repo, ["fetch", "origin"]);
      } catch (error) {
        console.error(`warning: fetch origin failed (${error.message.split(/\r?\n/)[0]}); using local refs`);
      }
    }
    const plan = resolvePlan(repo, args.flags);
    failPlan(plan);
    let inserted = 0;
    let updated = 0;
    let revisions = 0;
    for (const task of plan.tasks) {
      const result = upsertTaskFromContract(db, task.meta, { agent: agentOf(args.flags, { required: false }) });
      if (result.inserted) inserted += 1;
      else updated += 1;
      if (result.revisionChanged) revisions += 1;
    }
    print(
      { source: plan.source.label, tasks: plan.tasks.length, inserted, updated, revisions, warnings: plan.warnings },
      args.flags.json,
      `plan synced from ${plan.source.label}\n  tasks: ${plan.tasks.length} (${inserted} new, ${updated} known, ${revisions} revisions)\n  warnings: ${plan.warnings.join("; ") || "none"}`,
    );
    return EXIT.OK;
  }
  if (sub === "validate") {
    const plan = resolvePlan(repo, args.flags);
    if (args.flags.json) {
      print({ source: plan.source.label, errors: plan.errors, warnings: plan.warnings }, true);
    } else {
      console.log(`plan source: ${plan.source.label}`);
      console.log(`tasks: ${plan.tasks.length}, milestones: ${plan.milestones.length}`);
      for (const warning of plan.warnings) console.log(`warning: ${warning}`);
      for (const error of plan.errors) console.log(`error: ${error}`);
      console.log(plan.errors.length === 0 ? "plan is valid" : "plan is INVALID");
    }
    return plan.errors.length === 0 ? EXIT.OK : EXIT.REFUSED;
  }
  if (sub === "show") {
    if (args.flags.file) {
      const rel = String(args.flags.file).replaceAll("\\", "/").replace(/^\.?\//, "");
      console.log(planFileRead(repo, args.flags["plan-source"], rel));
      return EXIT.OK;
    }
    const plan = resolvePlan(repo, args.flags);
    const rows = plan.tasks.map((task) => {
      const state = getTask(db, task.meta.id);
      return {
        id: task.meta.id,
        rev: task.meta.rev,
        status: task.meta.status,
        state: state?.state ?? "not-synced",
        profile: task.meta.verification_profile,
        deps: (task.meta.dependencies ?? []).join(","),
      };
    });
    if (args.flags.json) {
      print({ source: plan.source.label, project: Boolean(plan.project), profiles: Object.keys(plan.policy.verification.profiles), tasks: rows, errors: plan.errors }, true);
    } else {
      console.log(`plan source: ${plan.source.label}`);
      console.log(`profiles: ${Object.keys(plan.policy.verification.profiles).join(", ")}`);
      console.log("| id | rev | status | runtime | profile | deps |");
      console.log("| --- | --- | --- | --- | --- | --- |");
      for (const row of rows) console.log(`| ${row.id} | ${row.rev} | ${row.status} | ${row.state} | ${row.profile} | ${row.deps || "-"} |`);
      if (plan.errors.length) console.log(`\nERRORS:\n${plan.errors.map((entry) => `- ${entry}`).join("\n")}`);
    }
    return plan.errors.length === 0 ? EXIT.OK : EXIT.REFUSED;
  }
  throw new UsageError("usage: agentctl plan <sync|validate|show> [--source <ref|worktree>] [--file <path>]");
}

function cmdTask(ctx) {
  const { repo, db, args } = ctx;
  const sub = args.positional[1];
  if (sub === "list") {
    const plan = resolvePlan(repo, args.flags);
    failPlan(plan);
    const rows = plan.tasks.map((task) => {
      const state = getTask(db, task.meta.id);
      return {
        id: task.meta.id,
        title: task.meta.title,
        rev: task.meta.rev,
        state: state?.state ?? "not-synced",
        owner: state?.owner_agent ?? null,
        lease: state?.lease_expires_at ?? null,
        deps: task.meta.dependencies ?? [],
      };
    });
    if (args.flags.json) {
      print(rows, true);
    } else {
      console.log("| id | state | rev | owner | title |");
      console.log("| --- | --- | --- | --- | --- |");
      for (const row of rows) console.log(`| ${row.id} | ${row.state} | ${row.rev} | ${row.owner ?? "-"} | ${row.title} |`);
    }
    return EXIT.OK;
  }
  if (sub === "show") {
    const id = args.positional[2] ?? args.flags.id;
    if (!id) throw new UsageError("usage: agentctl task show <T-0000>");
    const plan = resolvePlan(repo, args.flags);
    failPlan(plan);
    const entry = findContract(plan, id);
    const row = getTask(db, id);
    const ack = agentOf(args.flags, { required: false }) ? ackStatus(db, id, agentOf(args.flags, { required: false })) : null;
    const profile = entry.meta.verification_profile;
    const tree = tryGit(repo, ["rev-parse", "HEAD^{tree}"]);
    const evidence = latestEvidence(db, id, profile);
    const view = {
      contract: entry.meta,
      file: entry.file,
      source: plan.source.label,
      runtime: row,
      ack,
      evidence: evidence
        ? {
            id: evidence.id,
            profile: evidence.profile,
            status: evidence.status,
            tree: evidence.tree_sha?.slice(0, 12),
            current: evidence.status === "pass" && evidence.tree_sha === tree,
          }
        : null,
    };
    if (args.flags.json) {
      print(view, true);
    } else {
      console.log(`${entry.meta.id} rev ${entry.meta.rev} — ${entry.meta.title}`);
      console.log(`status: ${entry.meta.status}   runtime: ${row?.state ?? "not-synced"}   owner: ${row?.owner_agent ?? "-"}`);
      console.log(`profile: ${profile}   deps: ${(entry.meta.dependencies ?? []).join(", ") || "-"}`);
      console.log(`source: ${plan.source.label}`);
      console.log(`claim: ${row?.lease_expires_at ?? "none"}`);
      console.log(`evidence: ${evidence ? `#${evidence.id} ${evidence.status} tree ${evidence.tree_sha.slice(0, 12)}` : "none"}`);
      console.log(
        `deployment: impact=${entry.meta.deployment_impact ?? "unset"}${entry.meta.deployment_verification ? ` verification=${entry.meta.deployment_verification}` : ""}`,
      );
      console.log("\nacceptance:");
      for (const criterion of entry.meta.acceptance ?? []) console.log(`  - ${criterion}`);
      console.log("\nownership:");
      for (const glob of entry.meta.ownership ?? []) console.log(`  - ${glob}`);
      if (entry.meta.out_of_scope?.length) {
        console.log("\nout of scope:");
        for (const glob of entry.meta.out_of_scope) console.log(`  - ${glob}`);
      }
      if (row?.blocked_reason) console.log(`\nblocked: ${row.blocked_reason}`);
    }
    return EXIT.OK;
  }
  throw new UsageError("usage: agentctl task <list|show <id>>");
}

function cmdClaim(ctx) {
  const { repo, db, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl claim <T-0000> --agent <id> [--worktree <path>] [--branch <name>]");
  const agent = agentOf(args.flags);
  const plan = resolvePlan(repo, args.flags);
  failPlan(plan);
  const entry = findContract(plan, id);
  const contract = entry.meta;
  if (contract.status !== "ready") throw new Refusal(`contract ${id} status is "${contract.status}"; only ready tasks can be claimed`);
  for (const dependencyId of contract.dependencies ?? []) {
    const dependency = getTask(db, dependencyId);
    if (!dependency || !["integrated", "done"].includes(dependency.state)) {
      throw new Refusal(`dependency ${dependencyId} is ${dependency?.state ?? "unknown"}; only integrated tasks can be claimed`);
    }
  }
  const ownership = contract.ownership ?? [];
  const deploymentGate = deploymentContractIssues(contract, plan.policy);
  if (deploymentGate.warnings.length > 0) {
    throw new Refusal(`contract ${id}: ${deploymentGate.warnings.join("; ")}. Add deployment_impact and deployment_verification to the contract.`);
  }
  const overlaps = ownershipOverlaps(db, id, ownership);
  if (overlaps.length > 0) {
    throw new Refusal(
      `ownership overlaps an active claim:\n${overlaps.map((row) => `  - ${row.task}: ${row.mine} vs ${row.theirs}`).join("\n")}`,
    );
  }
  const branch = String(args.flags.branch ?? currentBranch(repo));
  if ((plan.policy.integration.protected_branches ?? []).includes(branch) || branch === plan.policy.integration.target_branch) {
    throw new Refusal(`branch ${branch} is protected or the integration target; create a task branch first`);
  }
  const worktree = path.resolve(String(args.flags.worktree ?? repo));
  const base = tryGit(repo, ["rev-parse", "origin/develop"]) ?? tryGit(repo, ["rev-parse", "develop"]);
  if (!base) throw new Refusal("cannot resolve the base branch; run agentctl plan sync");
  const leaseSeconds = Number(args.flags["lease-seconds"] ?? (plan.policy.claims?.lease_minutes ?? 15) * 60);
  const claim = claimTask(db, { taskId: id, agent, worktree, branch, baseCommit: base, leaseSeconds });
  ackContract(db, id, agent, contract.rev);
  print(
    { task: id, agent, ...claim, worktree, branch, base },
    args.flags.json,
    `claimed ${id} as ${agent}\n  fence: ${claim.fence}\n  lease: ${claim.expiresAt}\n  worktree: ${worktree}\n  branch: ${branch}\n  base: ${base.slice(0, 8)}`,
  );
  return EXIT.OK;
}

function cmdRenew(ctx) {
  const { db, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl renew <T-0000> --agent <id>");
  const agent = agentOf(args.flags);
  const result = renewClaim(db, id, agent);
  print(result, args.flags.json, `renewed ${id} (fence ${result.fence}) until ${result.expiresAt}`);
  return EXIT.OK;
}

function cmdRelease(ctx) {
  const { db, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl release <T-0000> --agent <id> [--reason text]");
  const agent = agentOf(args.flags);
  const result = releaseClaim(db, id, agent, String(args.flags.reason ?? "released"));
  print(result, args.flags.json, `released ${id}; runtime state is now ${result.state}`);
  return EXIT.OK;
}

function cmdJournal(ctx) {
  const { repo, db, dirs, args } = ctx;
  const id = args.positional[1];
  const message = args.flags.message ?? args.flags.m;
  if (!id || !message) throw new UsageError('usage: agentctl journal <T-0000> --agent <id> -m "note"');
  const agent = agentOf(args.flags);
  requireOwner(db, id, agent);
  const commit = tryGit(repo, ["rev-parse", "HEAD"]);
  appendJournal(db, { taskId: id, agent, message, commit });
  const journalPath = path.join(dirs.journal, `${id}.md`);
  fs.appendFileSync(journalPath, `- ${nowIso()} (${agent}, ${commit ? commit.slice(0, 8) : "no-commit"}): ${message}\n`);
  print({ task: id, message }, args.flags.json, `journaled ${id}: ${message}`);
  return EXIT.OK;
}

function cmdCheckpoint(ctx) {
  const { repo, db, dirs, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl checkpoint <T-0000> --agent <id> [-m note] [--push]");
  const agent = agentOf(args.flags);
  const { task, claim } = requireOwner(db, id, agent);
  const ack = ackStatus(db, id, agent);
  if (!ack.current) throw new Refusal(`contract rev ${ack.contractRev} is not acknowledged (you acked ${ack.ackedRev ?? "none"}); run agentctl ack ${id}`);
  const head = headSha(repo);
  const tree = treeSha(repo);
  const branch = currentBranch(repo);
  if (branch !== task.branch) throw new Refusal(`worktree branch is ${branch}, claim is for ${task.branch}`);
  const message = args.flags.message ?? null;
  db.prepare("UPDATE tasks SET head_commit = ?, updated_at = ? WHERE id = ?").run(head, nowIso(), id);
  if (message) appendJournal(db, { taskId: id, agent, message, commit: head });
  recordEvent(db, { taskId: id, agent, kind: "checkpoint", message: message ?? `head ${head.slice(0, 8)}`, commit: head });
  renewClaim(db, id, agent);
  let pushed = null;
  if (args.flags.push) {
    git(repo, ["push", "-u", "origin", branch]);
    const remote = (tryGit(repo, ["ls-remote", "origin", `refs/heads/${branch}`]) ?? "").split(/\s+/)[0];
    pushed = remote === head;
    if (!pushed) throw new Refusal(`push completed but origin/${branch} is not ${head.slice(0, 8)}`);
  }
  const lease = getTask(db, id)?.lease_expires_at;
  print(
    { task: id, head, tree, branch, fence: claim.fence, lease, pushed, message },
    args.flags.json,
    `checkpointed ${id}\n  head: ${head.slice(0, 8)}  branch: ${branch}${pushed === null ? "" : `  pushed: ${pushed}`}\n  lease until ${lease}`,
  );
  return EXIT.OK;
}

function cmdAck(ctx) {
  const { db, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl ack <T-0000> --agent <id> [--rev N]");
  const agent = agentOf(args.flags);
  const task = taskRow(db, id);
  const revision = Number(args.flags.rev ?? task.contract_rev);
  const result = ackContract(db, id, agent, revision);
  print(result, args.flags.json, `acknowledged ${id} rev ${result.revision}`);
  return EXIT.OK;
}

async function cmdVerify(ctx) {
  const { repo, db, dirs, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl verify <T-0000> --agent <id> [--profile name]");
  const agent = agentOf(args.flags);
  const plan = resolvePlan(repo, args.flags);
  failPlan(plan);
  const entry = findContract(plan, id);
  requireOwner(db, id, agent);
  const ack = ackStatus(db, id, agent);
  if (!ack.current) throw new Refusal(`contract rev ${ack.contractRev} is not acknowledged (you acked ${ack.ackedRev ?? "none"})`);
  const profileName = String(args.flags.profile ?? entry.meta.verification_profile);
  const profile = plan.policy.verification.profiles[profileName];
  if (!profile) throw new Refusal(`unknown verification profile "${profileName}"`);
  const tree = treeSha(repo);
  const commit = headSha(repo);
  let result;
  try {
    result = await runProfile(db, repo, dirs.common, {
      taskId: id,
      agent,
      profileName,
      profile,
      cwd: repo,
      tree,
      commit,
      note: `local verification on ${currentBranch(repo)}`,
    });
  } catch (error) {
    if (error?.name === "ResourceDeferral") {
      updateTask(db, id, { blocked_reason: `deferred: ${error.message}` });
      recordEvent(db, { taskId: id, agent, kind: "verification_deferred", message: error.message });
      if (args.flags.json) {
        print({ task: id, deferred: true, reason: error.message }, true);
      } else {
        console.error(`verify ${id} deferred by resource admission: ${error.message}`);
        console.error(
          "This is a scheduling deferral, not a task failure. Continue with light work or another eligible task; retry verify when resources allow.",
        );
      }
      return EXIT.REFUSED;
    }
    throw error;
  }
  if (result.status === "pass") {
    updateTask(db, id, { state: "verified", blocked_reason: null, head_commit: commit });
    recordEvent(db, { taskId: id, agent, kind: "verified", message: `${profileName} pass`, data: { evidenceId: result.evidenceId } });
  } else {
    updateTask(db, id, { state: "in_progress", blocked_reason: `verification failed (${profileName})`, head_commit: commit });
    recordEvent(db, { taskId: id, agent, kind: "verification_failed", message: profileName, data: { evidenceId: result.evidenceId } });
  }
  if (args.flags.json) {
    print({ ...result, logs: result.checks.map((check) => check.log) }, true);
  } else {
    console.log(`verify ${id} [${profileName}] -> ${result.status.toUpperCase()}  (evidence #${result.evidenceId}, tree ${tree.slice(0, 12)})`);
    for (const check of result.checks) {
      console.log(`  ${check.exit === 0 ? "PASS" : "FAIL"}  ${check.command}  (${check.durationMs}ms, ${check.level})`);
      console.log(`        log: ${check.log}`);
    }
  }
  return result.status === "pass" ? EXIT.OK : EXIT.REFUSED;
}

function cmdSubmit(ctx) {
  const { repo, db, args } = ctx;
  const id = args.positional[1];
  if (!id) throw new UsageError("usage: agentctl submit <T-0000> --agent <id>");
  const agent = agentOf(args.flags);
  const plan = resolvePlan(repo, args.flags);
  failPlan(plan);
  const entry = findContract(plan, id);
  const contract = entry.meta;
  const { task } = requireOwner(db, id, agent);
  const ack = ackStatus(db, id, agent);
  if (!ack.current) throw new Refusal(`contract rev ${task.contract_rev} not acknowledged`);
  if (!["claimed", "in_progress", "verified"].includes(task.state)) {
    throw new Refusal(`task state ${task.state} cannot be submitted`);
  }
  const branch = currentBranch(repo);
  if (branch !== task.branch) throw new Refusal(`worktree branch ${branch} != claimed branch ${task.branch}`);
  if (!isClean(repo)) throw new Refusal("worktree has uncommitted changes; commit or checkpoint them first");
  const tree = treeSha(repo);
  const head = headSha(repo);
  const evidence = latestEvidence(db, id, contract.verification_profile);
  if (!evidence || evidence.status !== "pass" || evidence.tree_sha !== tree) {
    throw new Refusal(
      `no passing evidence for tree ${tree.slice(0, 12)} (profile ${contract.verification_profile}); run agentctl verify first`,
    );
  }
  const base = task.base_commit ?? git(repo, ["merge-base", "develop", head]);
  const changed = git(repo, ["diff", "--name-only", base, head]).split(/\r?\n/).filter(Boolean);
  const violations = scopeViolations(changed, contract, { contractFile: entry.file });
  if (violations.length > 0) {
    throw new Refusal(`diff is outside ownership:\n${violations.map((row) => `  - ${row.file}: ${row.reason}`).join("\n")}`);
  }
  const worktreeRev = contractRevInWorktree(repo, entry.file);
  if (worktreeRev !== null && Number(worktreeRev) !== Number(task.contract_rev)) {
    throw new Refusal(`working-tree contract is rev ${worktreeRev} but state expects ${task.contract_rev}; sync the contract`);
  }
  const remoteLine = tryGit(repo, ["ls-remote", "origin", `refs/heads/${branch}`]);
  if (!remoteLine) throw new Refusal(`branch ${branch} is not on origin; push it first (agentctl checkpoint --push)`);
  const remoteSha = remoteLine.split(/\s+/)[0];
  if (remoteSha !== head) throw new Refusal(`origin/${branch} is ${remoteSha.slice(0, 8)}, HEAD is ${head.slice(0, 8)}; push the latest commit`);
  updateTask(db, id, {
    state: "submitted",
    head_commit: head,
    submitted_commit: head,
    submitted_tree: tree,
    blocked_reason: null,
  });
  recordEvent(db, { taskId: id, agent, kind: "submitted", message: `head ${head.slice(0, 8)}`, commit: head });
  print(
    { task: id, head, tree, branch, evidence: evidence.id, state: "submitted" },
    args.flags.json,
    `submitted ${id}\n  head: ${head.slice(0, 8)}  branch: ${branch}\n  evidence: #${evidence.id} (${contract.verification_profile})\n  next: agentctl integrate ${id} --agent <integrator>`,
  );
  return EXIT.OK;
}

function writeAmendmentFile({ repo, taskId, title, tier, floor, evidence, agent, approver, changes, baseRev, newRev, contractFile, forcedId = null, dbIds = [] }) {
  const amendmentsDir = path.join(repo, "plan", "amendments");
  fs.mkdirSync(amendmentsDir, { recursive: true });
  let id = forcedId;
  if (!id) {
    const fileIds = fs
      .readdirSync(amendmentsDir)
      .filter((name) => /^A-[0-9]{4}-.*\.md$/.test(name))
      .map((name) => Number(/^A-([0-9]{4})/.exec(name)[1]));
    const next = Math.max(0, ...fileIds, ...dbIds.map((value) => Number(value.slice(2)) || 0)) + 1;
    id = `A-${String(next).padStart(4, "0")}`;
  }
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "amendment";
  const file = path.join(amendmentsDir, `${id}-${slug}.md`);
  const lines = [
    "---",
    `id: ${id}`,
    `task: ${taskId}`,
    `base_rev: ${baseRev}`,
    `new_rev: ${newRev}`,
    `tier_floor: ${floor}`,
    `tier: ${tier}`,
    "status: accepted",
    `proposer: ${agent}`,
    `approver: ${approver ?? "self"}`,
    `evidence: ${yamlString(evidence)}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Changes",
    ...changes.map((change) => `- ${change.field}: ${change.description} (Tier ${change.tier})`),
    "",
    "## Applied contract",
    `- \`${contractFile}\` revision ${baseRev} -> ${newRev}`,
    "",
  ];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return { id, file: path.relative(repo, file).split(path.sep).join("/") };
}

function applyAmendment(ctx, { taskId, proposedPath, title, evidence, requestedTier, approveAgent, humanRef, baseRev: explicitBase, existingAmendment = null }) {
  const { repo, db, args } = ctx;
  const agent = agentOf(args.flags);
  const plan = resolvePlan(repo, args.flags);
  failPlan(plan);
  const entry = findContract(plan, taskId);
  const contract = entry.meta;
  const row = taskRow(db, taskId);
  const baseRev = Number(explicitBase ?? contract.rev);
  if (Number(contract.rev) !== Number(row.contract_rev) || baseRev !== Number(contract.rev)) {
    throw new Refusal(
      `stale amendment: base rev ${baseRev}, plan rev ${contract.rev}, state rev ${row.contract_rev}. Re-read the contract and retry.`,
    );
  }
  const absolute = path.resolve(proposedPath);
  const proposedText = fs.readFileSync(absolute, "utf8");
  const { meta: proposed } = parseFrontmatter(proposedText, { source: absolute });
  if (proposed.id !== taskId) throw new Refusal(`proposed contract id ${proposed.id} does not match ${taskId}`);

  // Reuse a pending proposal that is byte-identical (retry after approval), otherwise supersede it.
  let existing = existingAmendment;
  if (!existing) {
    const pending = db
      .prepare(
        "SELECT * FROM amendments WHERE task_id = ? AND base_rev = ? AND status IN ('proposed','awaiting_human') ORDER BY created_at DESC LIMIT 1",
      )
      .get(taskId, baseRev);
    if (pending) {
      if (pending.proposed_contract === proposedText) existing = pending;
      else db.prepare("UPDATE amendments SET status = 'superseded' WHERE id = ?").run(pending.id);
    }
  }
  const diff = diffContracts(contract, proposed, plan.policy.amendments.tiers);
  if (diff.changes.length === 0) throw new Refusal("proposed contract is identical; nothing to amend");
  const floor = diff.floor;
  const tier = Math.max(floor, Number(requestedTier ?? floor));
  if (!Number.isInteger(tier) || tier < floor) throw new Refusal(`tier ${requestedTier} is below the computed floor ${floor}`);

  let approver = null;
  if (tier >= 2 && tier < 3) {
    if (!approveAgent) {
      const id = recordProposedAmendment(db, { taskId, baseRev, floor, tier, title, evidence, agent, changes: diff.changes, proposedText, proposedPath: absolute });
      throw new Refusal(
        `amendment requires lead approval (tier ${tier}). Recorded as ${id} (status proposed). Retry with --approve <lead-agent-id> or run: agentctl amend approve ${id} --agent <lead>`,
      );
    }
    const lead = getAgent(db, approveAgent);
    const requiredRole = plan.policy.amendments.tier2_requires_role ?? "lead";
    if (!lead || lead.role !== requiredRole) throw new Refusal(`approver ${approveAgent} must be registered with role ${requiredRole}`);
    if (approveAgent === agent) throw new Refusal("the proposer cannot approve their own tier-2 amendment");
    approver = approveAgent;
  } else if (tier >= 3) {
    if (!humanRef) {
      const id = recordProposedAmendment(db, { taskId, baseRev, floor, tier, title, evidence, agent, changes: diff.changes, proposedText, proposedPath: absolute, status: "awaiting_human" });
      throw new Refusal(
        `tier 3 amendment requires human authorization. Recorded as ${id} (status awaiting_human). The task must park; unrelated work can continue.`,
      );
    }
    approver = `human:${humanRef}`;
  }

  const newRev = baseRev + 1;
  const rewritten = proposedText.replace(/^rev:\s*\d+\s*$/m, `rev: ${newRev}`);
  if (!/^rev:\s*\d+\s*$/m.test(proposedText)) {
    throw new Refusal("proposed contract is missing a rev field");
  }
  const worktreeRev = contractRevInWorktree(repo, entry.file);
  if (worktreeRev !== null && worktreeRev !== baseRev) {
    throw new Refusal(`working-tree contract is rev ${worktreeRev}, expected ${baseRev}; refresh before amending`);
  }

  const contractPath = path.join(repo, entry.file);
  const originalText = fs.readFileSync(contractPath, "utf8");
  let amendment = null;
  try {
    tx(db, () => {
      const rowNow = getTask(db, taskId);
      if (!rowNow) throw new StateRefusal(`unknown task ${taskId}`);
      if (Number(rowNow.contract_rev) !== baseRev) {
        throw new StateRefusal(
          `stale amendment: base rev ${baseRev}, state rev ${rowNow.contract_rev}. Re-read the contract and retry.`,
        );
      }
      const dbIds = db.prepare("SELECT id FROM amendments").all().map((row) => row.id);
      fs.writeFileSync(contractPath, rewritten, "utf8");
      amendment = writeAmendmentFile({
        repo,
        taskId,
        title,
        tier,
        floor,
        evidence,
        agent,
        approver,
        changes: diff.changes,
        baseRev,
        newRev,
        contractFile: entry.file,
        forcedId: existing?.id ?? null,
        dbIds,
      });
      const newMeta = { ...proposed, rev: newRev };
      upsertTaskFromContract(db, newMeta, { agent });
      if (["submitted", "integration_failed", "verified"].includes(rowNow.state)) {
        updateTask(db, taskId, { state: "in_progress", blocked_reason: null });
      }
      if (existing) {
        db.prepare(
          `UPDATE amendments SET status = 'accepted', approver = ?, decided_at = ?, proposed_contract = ?,
            proposed_path = ?, amendment_path = ?, tier = ?, tier_floor = ? WHERE id = ?`,
        ).run(approver, nowIso(), rewritten, entry.file, amendment.file, tier, floor, existing.id);
      } else {
        db.prepare(
          `INSERT INTO amendments (id, task_id, base_rev, new_rev, tier_floor, tier, kind, title, status, proposer, approver,
            evidence, changes_json, proposed_contract, proposed_path, amendment_path, created_at, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          amendment.id,
          taskId,
          baseRev,
          newRev,
          floor,
          tier,
          "contract",
          title,
          agent,
          approver,
          evidence,
          JSON.stringify(diff.changes),
          rewritten,
          entry.file,
          amendment.file,
          nowIso(),
          nowIso(),
        );
      }
      db.prepare(
        "UPDATE amendments SET status = 'superseded' WHERE task_id = ? AND status IN ('proposed','awaiting_human') AND id != ?",
      ).run(taskId, amendment.id);
      ackContract(db, taskId, agent, newRev);
      recordEvent(db, {
        taskId,
        agent,
        kind: "amendment_accepted",
        message: `${amendment.id} rev ${baseRev} -> ${newRev} (tier ${tier})`,
      });
    });
  } catch (error) {
    try {
      fs.writeFileSync(contractPath, originalText, "utf8");
    } catch {
      /* best-effort restore */
    }
    if (amendment?.file) {
      try {
        fs.rmSync(path.join(repo, amendment.file), { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    throw error;
  }
  print(
    { amendment: amendment.id, task: taskId, baseRev, newRev, tier, floor, approver, changes: diff.changes, file: amendment.file },
    ctx.args.flags.json,
    `amendment ${amendment.id} applied to ${taskId}: rev ${baseRev} -> ${newRev} (tier ${tier}, floor ${floor})\n  file: ${amendment.file}\n  next: commit the plan changes and run agentctl checkpoint`,
  );
  return EXIT.OK;
}

function recordProposedAmendment(db, { taskId, baseRev, floor, tier, title, evidence, agent, changes, proposedText, proposedPath, status = "proposed" }) {
  return tx(db, () => {
    const ids = db.prepare("SELECT id FROM amendments").all().map((row) => row.id);
    const next = (ids.length > 0 ? Math.max(...ids.map((id) => Number(id.slice(2)) || 0)) : 0) + 1;
    const id = `A-${String(next).padStart(4, "0")}`;
    db.prepare(
    `INSERT INTO amendments (id, task_id, base_rev, new_rev, tier_floor, tier, kind, title, status, proposer, approver,
      evidence, changes_json, proposed_contract, proposed_path, amendment_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'contract', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    id,
    taskId,
    baseRev,
    baseRev + 1,
    floor,
    tier,
    title,
    status,
    agent,
    evidence,
    JSON.stringify(changes),
    proposedText,
    proposedPath,
    nowIso(),
  );
    recordEvent(db, { taskId, agent, kind: `amendment_${status}`, message: `${id} tier ${tier} requires approval` });
    return id;
  });
}

function cmdAmend(ctx) {
  const { db, args } = ctx;
  const sub = args.positional[1];
  if (sub === "approve") {
    const amendmentId = args.positional[2];
    if (!amendmentId) throw new UsageError("usage: agentctl amend approve <A-0000> --agent <lead-id> [--human-ref <ref>]");
    const row = db.prepare("SELECT * FROM amendments WHERE id = ?").get(amendmentId);
    if (!row) throw new Refusal(`unknown amendment ${amendmentId}`);
    if (row.status === "accepted") throw new Refusal(`amendment ${amendmentId} is already accepted`);
    const humanRef = args.flags["human-ref"] ?? null;
    const okTier2 = row.tier < 3 && args.flags.agent;
    if (row.tier >= 3 && !humanRef) throw new Refusal("tier 3 amendment requires --human-ref <authorization reference>");
    if (row.tier < 3 && !okTier2) throw new Refusal("tier 2 amendment requires --agent <lead-id> with role lead");
    const tmp = path.join(os.tmpdir(), `agentops-amendment-${amendmentId}.md`);
    fs.writeFileSync(tmp, row.proposed_contract, "utf8");
    const result = applyAmendment(ctx, {
      taskId: row.task_id,
      proposedPath: tmp,
      title: row.title,
      evidence: row.evidence,
      requestedTier: row.tier,
      approveAgent: row.tier < 3 ? args.flags.agent : null,
      humanRef,
      baseRev: row.base_rev,
      existingAmendment: row,
    });
    fs.rmSync(tmp, { force: true });
    return result;
  }
  const taskId = sub;
  if (!taskId) throw new UsageError("usage: agentctl amend <T-0000> --contract <file> --title <t> --evidence <e> [--tier N] [--approve lead] [--human-ref ref]");
  const contractPath = args.flags.contract;
  if (!contractPath) throw new UsageError("--contract <path> is required");
  const title = args.flags.title;
  const evidence = args.flags.evidence;
  if (!title || !evidence) throw new UsageError("--title and --evidence are required");
  return applyAmendment(ctx, {
    taskId,
    proposedPath: contractPath,
    title,
    evidence,
    requestedTier: args.flags.tier ? Number(args.flags.tier) : null,
    approveAgent: args.flags.approve ?? null,
    humanRef: args.flags["human-ref"] ?? null,
    baseRev: args.flags["base-rev"] ?? null,
  });
}

function cmdIntegrate(ctx) {
  return integrateTask({
    db: ctx.db,
    repo: ctx.repo,
    commonDir: ctx.dirs.common,
    taskId: ctx.args.positional[1],
    agent: agentOf(ctx.args.flags),
    planSource: ctx.args.flags["plan-source"] ?? "auto",
  }).then((result) => {
    if (ctx.args.flags.json) print(result, true);
    else if (result.alreadyIntegrated) {
      console.log(`${result.taskId}: changes already present in develop@${result.develop.slice(0, 8)}`);
    } else {
      console.log(`integrated ${result.taskId}`);
      console.log(`  develop: ${result.developBefore.slice(0, 8)} -> ${result.developAfter.slice(0, 8)}  (merge ${result.mergeCommit.slice(0, 8)})`);
      console.log(`  verification: ${result.verification} (evidence #${result.evidenceId})`);
      console.log(`  remote: verified  state: ${result.state}`);
      if (result.deployment) {
        console.log(`  deployment: ${result.deployment.branch} is allowlisted; the automatic deployment follows this push (no manual deploy)`);
      }
      if (result.migration) console.log(`  migration: ${result.migration.ok ? "applied and verified" : "FAILED"}`);
    }
    return EXIT.OK;
  });
}

function cmdDb(ctx) {
  const { repo, db, dirs, args } = ctx;
  const sub = args.positional[1];
  const plan = resolvePlan(repo, args.flags);
  failPlan(plan);
  if (sub === "status") {
    const status = databaseStatus(repo, plan.policy);
    print(status, args.flags.json, [
      `tool: ${status.tool}`,
      `dev project ref: ${status.configuredProjectRef ?? "(not configured)"}`,
      `production refs: ${(status.productionRefs ?? []).join(", ") || "(none configured)"}`,
      `env file: ${status.envFile}`,
      `target verified: ${status.verified}${status.reason ? ` (${status.reason})` : ""}`,
      `migrate command: ${status.migrateCommand ?? "(none)"}`,
    ].join("\n"));
    return status.verified ? EXIT.OK : EXIT.REFUSED;
  }
  if (sub === "push") {
    const agent = agentOf(args.flags);
    return runDevelopmentMigration({ db, repo, commonDir: dirs.common, policy: plan.policy, agent, taskId: args.flags.task ?? null }).then((result) => {
      print(
        { target: result.target, ok: result.ok, migrate: result.migrate, verify: result.verify },
        args.flags.json,
        `database migration target ${result.target.projectRef} (${result.target.host})\n  migrate exit: ${result.migrate.exitCode}${result.verify ? `\n  verify exit: ${result.verify.exitCode}` : ""}\n  result: ${result.ok ? "OK" : "FAILED"}`,
      );
      return result.ok ? EXIT.OK : EXIT.REFUSED;
    });
  }
  throw new UsageError("usage: agentctl db <status|push> [--task T-0000]");
}

function cmdResources(ctx) {
  const measured = measure(ctx.repo);
  print(measured, ctx.args.flags.json, [
    `level: ${measured.level}`,
    `memory: ${Math.round(measured.freeMemGb * 10) / 10} GB free of ${Math.round(measured.totalMemGb * 10) / 10} GB`,
    `CPU load: ${measured.loadPct === null ? "unknown" : `${measured.loadPct}%`}   cores: ${measured.cpuCount}`,
    `disk: ${measured.freeDiskGb === null ? "unknown" : `${Math.round(measured.freeDiskGb * 10) / 10} GB free`}`,
    `slots: ${measured.heavySlots} heavy / ${measured.moderateSlots} moderate (advisory)`,
    `advice: ${measured.advice}`,
  ].join("\n"));
  return EXIT.OK;
}

function cmdInventory(ctx) {
  const result = inventory(ctx.repo);
  const claims = ctx.db
    .prepare(
      `SELECT task_id, agent, worktree, expires_at FROM claims WHERE released_at IS NULL AND expires_at > ?`,
    )
    .all(nowIso());
  const annotated = {
    ...result,
    worktrees: result.worktrees.map((worktree) => ({
      ...worktree,
      claimedBy: claims.filter((claim) => claim.worktree === worktree.path).map((claim) => claim.task_id),
    })),
  };
  if (ctx.args.flags.json) {
    print(annotated, true);
  } else {
    console.log(`repository: ${annotated.root}`);
    console.log(`base: ${annotated.base ?? "(none)"}`);
    console.log("| class | branch | head | changes | vs base | remote | claimed | worktree |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const worktree of annotated.worktrees) {
      const changes = worktree.status
        ? `${worktree.status.staged}/${worktree.status.unstaged}/${worktree.status.untracked}`
        : "?";
      const vs = worktree.vsBase ? `+${worktree.vsBase.ahead}/-${worktree.vsBase.behind}` : "-";
      console.log(
        `| ${worktree.classification} | ${worktree.branch ?? "(detached)"} | ${worktree.head?.slice(0, 7)} | ${changes} | ${vs} | ${worktree.headOnRemote ? "yes" : "no"} | ${worktree.claimedBy.join(",") || "-"} | ${worktree.path} |`,
      );
    }
  }
  return EXIT.OK;
}

function cmdStatus(ctx) {
  const { repo, db } = ctx;
  const tasks = listTasks(db);
  const resources = measure(repo);
  const develop = tryGit(repo, ["rev-parse", "develop"]);
  const originDevelop = tryGit(repo, ["rev-parse", "origin/develop"]);
  const claims = db
    .prepare("SELECT task_id, agent, expires_at FROM claims WHERE released_at IS NULL AND expires_at > ?")
    .all(nowIso());
  const locks = db.prepare("SELECT * FROM locks ORDER BY name").all();
  const view = {
    repository: repo,
    develop,
    originDevelop,
    developSynced: develop === originDevelop,
    resources: { level: resources.level, freeMemGb: Math.round(resources.freeMemGb * 10) / 10, loadPct: resources.loadPct },
    tasks: tasks.map((task) => ({
      id: task.id,
      state: task.state,
      rev: task.contract_rev,
      owner: task.owner_agent,
      lease: task.lease_expires_at,
      blocked: task.blocked_reason ?? null,
      integrated: task.integrated_commit,
    })),
    claims,
    locks,
  };
  if (ctx.args.flags.json) {
    print(view, true);
  } else {
    console.log(`repo: ${repo}`);
    console.log(`develop: ${develop?.slice(0, 8) ?? "?"}  origin/develop: ${originDevelop?.slice(0, 8) ?? "?"}  synced: ${develop === originDevelop}`);
    console.log(`resources: ${resources.level} (${Math.round(resources.freeMemGb * 10) / 10} GB free, load ${resources.loadPct ?? "?"}%)`);
    console.log("\n| task | state | rev | owner | lease |");
    console.log("| --- | --- | --- | --- | --- |");
    for (const task of view.tasks) console.log(`| ${task.id} | ${task.state} | ${task.rev} | ${task.owner ?? "-"} | ${task.lease ?? "-"} |`);
    if (claims.length) console.log(`\nactive claims: ${claims.map((claim) => `${claim.task_id}@${claim.agent} until ${claim.expires_at}`).join("; ")}`);
    if (locks.length) console.log(`locks: ${locks.map((lock) => `${lock.name}@${lock.owner} until ${lock.expires_at}`).join("; ")}`);
    const blocked = view.tasks.filter((task) => task.blocked);
    if (blocked.length) console.log(`\ndeferred/blocked: ${blocked.map((task) => `${task.id}: ${task.blocked}`).join(" | ")}`);
  }
  return EXIT.OK;
}

function cmdReport(ctx) {
  const { repo, db, dirs } = ctx;
  const plan = resolvePlan(repo, ctx.args.flags);
  const allowedDeployBranches = plan.policy.deployment?.allowed_branches ?? ["main", "develop"];
  const tasks = listTasks(db);
  const develop = tryGit(repo, ["rev-parse", "develop"]);
  const originDevelop = tryGit(repo, ["rev-parse", "origin/develop"]);
  const resources = measure(repo);
  const worktrees = inventory(repo);
  const lines = [
    `# AgentOps report — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `- Repository: \`${repo}\``,
    `- Integration target: \`develop\``,
    `- develop: \`${develop ?? "?"}\``,
    `- origin/develop: \`${originDevelop ?? "?"}\` (synced: ${develop === originDevelop})`,
    `- Resource level: **${resources.level}** (${Math.round(resources.freeMemGb * 10) / 10} GB free, load ${resources.loadPct ?? "?"}%)`,
    `- Deployment policy: automatic Vercel deployments allowed only for \`${allowedDeployBranches.join("`, `")}\` (static allowlist)`,
    "",
    "## Tasks",
    "",
    "| id | state | rev | owner | submitted | integrated |",
    "| --- | --- | --- | --- | --- | --- |",
    ...tasks.map(
      (task) =>
        `| ${task.id} | ${task.state} | ${task.contract_rev} | ${task.owner_agent ?? "-"} | ${task.submitted_commit?.slice(0, 8) ?? "-"} | ${task.integrated_commit?.slice(0, 8) ?? "-"} |`,
    ),
    "",
    "## Latest evidence per task",
    "",
    "| task | profile | status | tree | created |",
    "| --- | --- | --- | --- | --- |",
    ...tasks.map((task) => {
      const evidence = db.prepare("SELECT * FROM evidence WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(task.id);
      return evidence
        ? `| ${task.id} | ${evidence.profile} | ${evidence.status} | ${evidence.tree_sha.slice(0, 12)} | ${evidence.created_at} |`
        : `| ${task.id} | - | - | - | - |`;
    }),
    "",
    "## Amendments",
    "",
    ...(db.prepare("SELECT * FROM amendments ORDER BY created_at").all().length
      ? db
          .prepare("SELECT * FROM amendments ORDER BY created_at")
          .all()
          .map((row) => `- ${row.id} ${row.task_id}: tier ${row.tier} (floor ${row.tier_floor}) — ${row.status} by ${row.approver ?? row.proposer}`)
      : ["- none"]),
    "",
    "## Locks and leases",
    "",
    ...(db.prepare("SELECT * FROM locks").all().length
      ? db.prepare("SELECT * FROM locks").all().map((lock) => `- lock \`${lock.name}\` held by ${lock.owner} until ${lock.expires_at}`)
      : ["- no locks"]),
    "",
    "## Worktrees",
    "",
    "| class | branch | head | changes | remote | worktree |",
    "| --- | --- | --- | --- | --- | --- |",
    ...worktrees.worktrees.map((worktree) => {
      const changes = worktree.status ? `${worktree.status.staged}/${worktree.status.unstaged}/${worktree.status.untracked}` : "?";
      return `| ${worktree.classification} | ${worktree.branch ?? "(detached)"} | ${worktree.head?.slice(0, 7)} | ${changes} | ${worktree.headOnRemote ? "yes" : "no"} | ${worktree.path} |`;
    }),
    "",
    "_Counts and Git state above were read by agentctl from the state database and Git; no model invented them._",
  ];
  const markdown = `${lines.join("\n")}\n`;
  const outPath = ctx.args.flags.out ? path.resolve(String(ctx.args.flags.out)) : null;
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown, "utf8");
    console.log(`report written: ${outPath}`);
  } else {
    process.stdout.write(markdown);
  }
  if (ctx.args.flags.save) {
    const file = path.join(dirs.reports, `run-${new Date().toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(file, markdown, "utf8");
    if (!outPath) console.log(`report saved: ${file}`);
  }
  return EXIT.OK;
}

function cmdCleanup(ctx) {
  const { repo, db, args } = ctx;
  const plan = resolvePlan(repo, args.flags);
  const target = plan.policy.integration.target_branch;
  const inventoryResult = inventory(repo);
  const claims = db
    .prepare("SELECT * FROM claims WHERE released_at IS NULL AND expires_at > ?")
    .all(nowIso());
  const rows = [];
  for (const worktree of inventoryResult.worktrees) {
    const reasons = [];
    let removable = true;
    if (worktree.path === inventoryResult.root) {
      removable = false;
      reasons.push("primary worktree");
    }
    if (worktree.locked) {
      removable = false;
      reasons.push(`locked: ${worktree.locked}`);
    }
    if (worktree.prunable) {
      removable = false;
      reasons.push(`prunable: ${worktree.prunable}`);
    }
    if (worktree.status?.dirty) {
      removable = false;
      reasons.push(`uncommitted work (${worktree.status.staged}/${worktree.status.unstaged}/${worktree.status.untracked})`);
    }
    const claimed = claims.find((claim) => path.resolve(claim.worktree ?? "") === path.resolve(worktree.path));
    if (claimed) {
      removable = false;
      reasons.push(`active claim ${claimed.task_id}@${claimed.agent} until ${claimed.expires_at}`);
    }
    if (worktree.branch && (plan.policy.integration.protected_branches ?? []).includes(worktree.branch)) {
      removable = false;
      reasons.push("protected branch");
    }
    if (!worktree.branch) {
      removable = false;
      reasons.push("detached HEAD with unknown ownership");
    }
    if (worktree.branch) {
      const task = db.prepare("SELECT * FROM tasks WHERE branch = ? ORDER BY id DESC LIMIT 1").get(worktree.branch);
      if (!task) {
        removable = false;
        reasons.push("no task record for this branch");
      } else if (!["integrated", "done", "cancelled", "superseded"].includes(task.state)) {
        removable = false;
        reasons.push(`task ${task.id} is ${task.state}`);
      }
    }
    if (worktree.head && !worktree.headOnRemote) {
      removable = false;
      reasons.push("head commit is not on the remote (unpreserved)");
    }
    rows.push({ path: worktree.path, branch: worktree.branch, head: worktree.head, removable, reasons });
  }

  if (args.flags.json) print(rows, true);
  else {
    console.log("| worktree | branch | decision | reasons |");
    console.log("| --- | --- | --- | --- |");
    for (const row of rows) console.log(`| ${row.path} | ${row.branch ?? "(detached)"} | ${row.removable ? "REMOVABLE" : "RETAIN"} | ${row.reasons.join("; ") || "-"} |`);
  }

  if (args.flags.apply) {
    if (plan.policy.cleanup?.require_apply_flag !== false && !args.flags.apply) {
      throw new Refusal("cleanup requires --apply");
    }
    const removable = rows.filter((row) => row.removable);
    for (const row of removable) {
      const recheck = tryGit(repo, ["worktree", "list", "--porcelain"]);
      if (!recheck?.includes(row.path.replaceAll("\\", "/"))) continue;
      try {
        git(repo, ["worktree", "remove", row.path]);
        if (row.branch) {
          const merged = tryGit(repo, ["merge-base", "--is-ancestor", row.head, target]) !== null;
          if (merged) tryGit(repo, ["branch", "-d", row.branch]);
        }
        recordEvent(db, { taskId: null, agent: agentOf(args.flags, { required: false }), kind: "worktree_removed", message: row.path });
        console.log(`removed: ${row.path}`);
      } catch (error) {
        console.error(`failed to remove ${row.path}: ${error.message.split(/\r?\n/)[0]}`);
      }
    }
    if (removable.length === 0) console.log("nothing removable");
  }
  return EXIT.OK;
}

function cmdLease(ctx) {
  const sub = ctx.args.positional[1];
  if (sub === "reap") {
    const reaped = reapExpired(ctx.db);
    print({ reaped: reaped.length, tasks: reaped.map((claim) => claim.task_id) }, ctx.args.flags.json, `reaped ${reaped.length} expired lease(s): ${reaped.map((claim) => claim.task_id).join(", ") || "none"}`);
    return EXIT.OK;
  }
  throw new UsageError("usage: agentctl lease reap");
}

function cmdInit(ctx) {
  const repo = ctx.repo;
  const dirs = ["plan/milestones", "plan/tasks", "plan/amendments", "plan/evidence", "knowledge/decisions"];
  for (const dir of dirs) fs.mkdirSync(path.join(repo, dir), { recursive: true });
  console.log(`initialized plan directories in ${repo}`);
  console.log("next: add plan/PROJECT.md, plan/policy.yaml, milestones and task contracts, then run agentctl plan validate");
  return EXIT.OK;
}

const HELP = `agentctl — AgentOps planning backbone

usage: agentctl <command> [options]

Plan
  plan sync [--source <ref|worktree>] [--offline]   fetch and upsert task contracts
  plan validate [--source ...]                       validate contracts, profiles, dependencies
  plan show [--file <path>] [--source ...]           show plan/task summary or a raw plan file

Tasks
  task list | task show <T-0000> [--agent <id>]
  claim <T-0000> --agent <id> [--worktree <path>] [--branch <name>] [--lease-seconds N]
  renew <T-0000> --agent <id>
  release <T-0000> --agent <id> [--reason <text>]
  ack <T-0000> --agent <id> [--rev N]
  journal <T-0000> --agent <id> -m <note>
  checkpoint <T-0000> --agent <id> [-m <note>] [--push]
  verify <T-0000> --agent <id> [--profile <name>]
  submit <T-0000> --agent <id>

Amendments
  amend <T-0000> --agent <id> --contract <file> --title <t> --evidence <e> [--tier N] [--approve <lead>] [--human-ref <ref>]
  amend approve <A-0000> --agent <lead> [--human-ref <ref>]

Integration
  integrate <T-0000> --agent <integrator> [--plan-source <ref|worktree>]

Database
  db status
  db push --agent <id> [--task <T-0000>]

Machine
  resources | inventory | status | report [--out <file>] [--save]
  cleanup [--apply] [--agent <id>]
  lease reap
  agent register --id <id> --role <implementer|lead|reviewer|integrator>
  agent list
  init

All state lives in <git-common-dir>/agentops/state.db. Plan files are read through Git refs.
`;

/* -------------------------------------------------------------------- main */

async function dispatch(ctx) {
  const command = ctx.args.positional[0];
  switch (command) {
    case "agent":
      return cmdAgent(ctx);
    case "plan":
      return cmdPlan(ctx);
    case "task":
      return cmdTask(ctx);
    case "claim":
      return cmdClaim(ctx);
    case "renew":
      return cmdRenew(ctx);
    case "release":
      return cmdRelease(ctx);
    case "journal":
      return cmdJournal(ctx);
    case "checkpoint":
      return cmdCheckpoint(ctx);
    case "ack":
      return cmdAck(ctx);
    case "verify":
      return cmdVerify(ctx);
    case "submit":
      return cmdSubmit(ctx);
    case "amend":
      return cmdAmend(ctx);
    case "integrate":
      return cmdIntegrate(ctx);
    case "db":
      return cmdDb(ctx);
    case "resources":
      return cmdResources(ctx);
    case "inventory":
      return cmdInventory(ctx);
    case "status":
      return cmdStatus(ctx);
    case "report":
      return cmdReport(ctx);
    case "cleanup":
      return cmdCleanup(ctx);
    case "lease":
      return cmdLease(ctx);
    case "init":
      return cmdInit(ctx);
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return EXIT.OK;
    default:
      throw new UsageError(`unknown command: ${command ?? "(none)"}\n\n${HELP}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.positional[0] === "help" || args.flags.help) {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  const repo = repoRoot(args.flags.repo);
  const { db, dirs } = openState(repo);
  try {
    return await dispatch({ repo, db, dirs, args });
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error?.name === "UsageError") {
        console.error(error.message);
        process.exitCode = EXIT.USAGE;
      } else if (error?.name === "Refusal" || error?.name === "ResourceDeferral" || error?.name === "StateRefusal" || error?.name === "PlanError" || error?.name === "YamlError") {
        console.error(error.message);
        if (error.details?.length) console.error(error.details.join("\n"));
        process.exitCode = EXIT.REFUSED;
      } else {
        console.error(error?.stack ?? error?.message ?? String(error));
        process.exitCode = EXIT.ANOMALY;
      }
    });
}

export { main };
