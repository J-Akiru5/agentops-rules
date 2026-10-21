#!/usr/bin/env node
/**
 * AgentOps global rules installer.
 *
 * Installs the team's OpenCode development protocol on this machine:
 *   ~/.config/opencode/AGENTS.md                 -> managed block (existing content preserved)
 *   ~/.config/opencode/instructions/*.md         -> managed rule files
 *   ~/.config/opencode/bin/agentctl.mjs + agentops/*.mjs -> AgentOps CLI
 *   ~/.config/opencode/opencode.jsonc            -> instructions + permission merge
 *
 * OpenCode V1 and V2 are both supported:
 *   - V1 writes the `permission.shell` object (last match wins).
 *   - V2 writes the ordered `permissions` array.
 * The target is detected from `opencode --version`; override with --opencode v1|v2.
 * A V2 `permissions` array is removed when installing for V1, and instruction entries are normalized
 * to absolute paths so both versions resolve them deterministically.
 *
 * Non-destructive: modified files are backed up under <target>/.agentops/backups/<timestamp>/.
 *
 * Usage:
 *   node install.mjs [--target <dir>] [--opencode auto|v1|v2]
 *                    [--dry-run] [--no-backup] [--run-tests]
 *
 * No network access, no secrets, no deployment side effects.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(ROOT, "rules");
const BIN_DIR = path.join(ROOT, "bin");
const VERSION = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  } catch {
    return "0.0.0";
  }
})();

const BEGIN = "<!-- BEGIN agentops-global (managed) -->";
const END = "<!-- END agentops-global (managed) -->";

const MANAGED_INSTRUCTION_FILES = [
  "autonomous-orchestration.md",
  "agentops-backbone.md",
  "deployment-governance.md",
  "team-development.md",
];

const MANAGED_PERMISSIONS = [
  { action: "shell", resource: "git push --force*", effect: "ask" },
  { action: "shell", resource: "git push -f*", effect: "ask" },
  { action: "shell", resource: "git push * --force*", effect: "ask" },
  { action: "shell", resource: "git push * -f*", effect: "ask" },
  { action: "shell", resource: "git push * --delete*", effect: "ask" },
  { action: "shell", resource: "git reset --hard*", effect: "ask" },
  { action: "shell", resource: "git clean -*", effect: "ask" },
  { action: "shell", resource: "git worktree remove *--force*", effect: "ask" },
  { action: "shell", resource: "git branch -D*", effect: "ask" },
  { action: "shell", resource: "vercel --prod*", effect: "ask" },
  { action: "shell", resource: "vercel deploy --prod*", effect: "ask" },
  { action: "shell", resource: "vercel deploy*", effect: "ask" },
  { action: "shell", resource: "vercel *deploy*", effect: "ask" },
  { action: "shell", resource: "vercel promote*", effect: "ask" },
  { action: "shell", resource: "vercel *promote*", effect: "ask" },
  { action: "shell", resource: "vercel redeploy*", effect: "ask" },
  { action: "shell", resource: "vercel *redeploy*", effect: "ask" },
  { action: "shell", resource: "vercel rollback*", effect: "ask" },
  { action: "shell", resource: "npx vercel*", effect: "ask" },
  { action: "shell", resource: "*deploy-hook*", effect: "ask" },
  { action: "shell", resource: "supabase db reset*", effect: "ask" },
  { action: "shell", resource: "supabase migration repair*", effect: "ask" },
  { action: "shell", resource: "gh pr merge * --admin*", effect: "ask" },
  { action: "shell", resource: "gh api *-X DELETE*", effect: "ask" },
  { action: "shell", resource: "rm -r*", effect: "ask" },
  { action: "shell", resource: "Remove-Item *-Recurse*", effect: "ask" },
  { action: "shell", resource: "rd /s*", effect: "ask" },
];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    const [name, inline] = arg.slice(2).split("=");
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

function defaultTarget() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "opencode");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips // and block comments outside strings so JSONC can be parsed by JSON.parse. */
function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inString = false;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      quote = '"';
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function readConfig(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(stripJsonc(text));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${file} must contain a JSON object`);
    }
    return parsed;
  } catch (error) {
    fail(`cannot parse ${file}: ${error.message}. Fix it, then rerun the installer (nothing was changed).`);
  }
  return {};
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** Returns the generation of the `opencode` binary, or an explicit override. */
function detectOpenCode(explicit) {
  if (explicit === "v1" || explicit === "v2") {
    return { generation: explicit, source: "explicit override", detected: false };
  }
  if (explicit && explicit !== "auto") fail(`--opencode must be auto, v1 or v2 (got ${explicit})`);

  const attempts = [];
  if (process.platform === "win32") {
    attempts.push(["powershell", ["-NoProfile", "-Command", "opencode --version"]]);
    attempts.push(["cmd", ["/c", "opencode --version"]]);
    attempts.push(["cmd", ["/c", "opencode2 --version"]]);
  } else {
    attempts.push(["opencode", ["--version"]]);
    attempts.push(["opencode2", ["--version"]]);
  }
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 20_000, windowsHide: true });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const match = /(?:^|\D)([12])\.\d+/.exec(output);
    if (result.status === 0 && match) {
      return {
        generation: match[1] === "1" ? "v1" : "v2",
        source: (result.stdout ?? "").trim() || output.trim(),
        detected: true,
      };
    }
  }
  fail(
    "Could not detect OpenCode. Run `opencode --version` (or `opencode2 --version`), then rerun with `--opencode v1` or `--opencode v2`.",
  );
  return { generation: "v2", source: "fallback", detected: false };
}

function managedInstructionPaths(target) {
  return MANAGED_INSTRUCTION_FILES.map((name) =>
    path.join(target, "instructions", name).split(path.sep).join("/"),
  );
}

function isManagedInstructionEntry(entry) {
  const normalized = String(entry).replaceAll("\\", "/");
  return MANAGED_INSTRUCTION_FILES.some(
    (name) => normalized.endsWith(`/instructions/${name}`) || normalized === `instructions/${name}`,
  );
}

function mergeInstructions(config, target) {
  const before = Array.isArray(config.instructions) ? config.instructions : [];
  const kept = before.filter((entry) => !isManagedInstructionEntry(entry));
  const managed = managedInstructionPaths(target);
  config.instructions = [...kept, ...managed];
  return { added: managed.length, removed: before.length - kept.length };
}

/** V1: `permission.shell` object; last matching pattern wins. */
function applyV1Permissions(config) {
  const permission = config.permission;
  let base;
  if (typeof permission === "string") base = { "*": permission };
  else if (permission && typeof permission === "object" && !Array.isArray(permission)) base = { ...permission };
  else base = {};

  const hadPermissionsArray = Object.hasOwn(config, "permissions");
  delete config.permissions;

  if (base["*"] === "deny" || base.shell === "deny") {
    config.permission = base;
    return { rules: 0, hadPermissionsArray, skipped: "shell is denied by the existing config" };
  }

  let shell;
  if (typeof base.shell === "string") shell = { "*": base.shell };
  else if (base.shell && typeof base.shell === "object" && !Array.isArray(base.shell)) shell = { ...base.shell };
  else shell = {};

  const managedPatterns = new Set(MANAGED_PERMISSIONS.map((rule) => rule.resource));
  const preserved = {};
  for (const [pattern, action] of Object.entries(shell)) {
    if (!managedPatterns.has(pattern)) preserved[pattern] = action;
  }
  const ordered = { ...preserved };
  for (const rule of MANAGED_PERMISSIONS) ordered[rule.resource] = rule.effect;
  config.permission = { ...base, shell: ordered };
  return { rules: MANAGED_PERMISSIONS.length, hadPermissionsArray, skipped: null };
}

/** V2: ordered `permissions` array. */
function applyV2Permissions(config) {
  const permissions = Array.isArray(config.permissions) ? config.permissions : [];
  let added = 0;
  for (const rule of MANAGED_PERMISSIONS) {
    const exists = permissions.some(
      (entry) => entry && entry.action === rule.action && entry.resource === rule.resource && entry.effect === rule.effect,
    );
    if (!exists) {
      permissions.push(rule);
      added += 1;
    }
  }
  config.permissions = permissions;
  return { rules: MANAGED_PERMISSIONS.length, added, legacyPermission: Boolean(config.permission) };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      "usage: node install.mjs [--target <dir>] [--opencode auto|v1|v2] [--dry-run] [--no-backup] [--run-tests]",
    );
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    fail("Node.js >= 22.5 is required (node:sqlite). Update Node and rerun.");
  }

  const target = path.resolve(flags.target ? String(flags.target) : defaultTarget());
  const dryRun = Boolean(flags["dry-run"]);
  const noBackup = Boolean(flags["no-backup"]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(target, ".agentops", "backups", stamp);
  let backedUp = 0;
  const opencode = detectOpenCode(flags.opencode ? String(flags.opencode) : "auto");

  if (!fs.existsSync(path.join(RULES_DIR, "AGENTS.md"))) fail("package is incomplete: rules/AGENTS.md missing");
  if (!fs.existsSync(path.join(RULES_DIR, "instructions", "team-development.md"))) {
    fail("package is incomplete: rules/instructions/team-development.md missing");
  }
  if (!fs.existsSync(path.join(BIN_DIR, "agentctl.mjs"))) fail("package is incomplete: bin/agentctl.mjs missing");

  const configJsonc = path.join(target, "opencode.jsonc");
  const configJson = path.join(target, "opencode.json");
  const configPath = fs.existsSync(configJsonc) ? configJsonc : fs.existsSync(configJson) ? configJson : configJsonc;

  // Validate existing config before touching anything.
  const existingConfig = fs.existsSync(configPath) ? readConfig(configPath) : {};
  const existingAgentsPath = path.join(target, "AGENTS.md");
  const existingAgents = fs.existsSync(existingAgentsPath) ? fs.readFileSync(existingAgentsPath, "utf8") : "";
  if (existingAgents.includes(BEGIN) && !existingAgents.includes(END)) {
    fail(`${existingAgentsPath} contains the managed BEGIN marker without END; fix it manually before installing`);
  }

  function backup(file) {
    if (dryRun || noBackup || !fs.existsSync(file)) return;
    const dest = path.join(backupRoot, path.relative(target, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    backedUp += 1;
  }

  function write(file, content) {
    if (dryRun) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }

  function copy(src, dest) {
    backup(dest);
    if (dryRun) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // 1. AGENTS.md managed block
  const managedAgents = fs.readFileSync(path.join(RULES_DIR, "AGENTS.md"), "utf8").trim();
  const block = `${BEGIN}\n${managedAgents}\n${END}`;
  let agentsContent;
  if (existingAgents.includes(BEGIN) && existingAgents.includes(END)) {
    agentsContent = existingAgents.replace(new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`), block);
  } else if (!existingAgents.trim()) {
    agentsContent = `${block}\n`;
  } else if (existingAgents.trim() === managedAgents) {
    agentsContent = `${block}\n`;
  } else if (existingAgents.includes(managedAgents)) {
    agentsContent = existingAgents.replace(managedAgents, block);
  } else {
    agentsContent = `${existingAgents.trimEnd()}\n\n${block}\n`;
  }
  write(existingAgentsPath, agentsContent);

  // 2. Instruction files
  const instructionDir = path.join(target, "instructions");
  const instructionFiles = fs.readdirSync(path.join(RULES_DIR, "instructions")).filter((name) => name.endsWith(".md"));
  for (const name of instructionFiles) {
    copy(path.join(RULES_DIR, "instructions", name), path.join(instructionDir, name));
  }

  // 3. agentctl + orchestrator (machine-global CLI)
  const binFiles = walkFiles(BIN_DIR);
  for (const rel of binFiles) {
    copy(path.join(BIN_DIR, rel), path.join(target, "bin", rel));
  }

  // 4. Config merge, version-aware
  const config = structuredClone(existingConfig);
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  const instructionMerge = mergeInstructions(config, target);
  const permissionMerge =
    opencode.generation === "v1" ? applyV1Permissions(config) : applyV2Permissions(config);
  write(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // 5. Verify the installed CLI behaves even without a repository.
  if (!dryRun) {
    const verify = spawnSync(process.execPath, [path.join(target, "bin", "agentctl.mjs"), "help"], {
      encoding: "utf8",
      cwd: target,
      timeout: 60_000,
    });
    if (verify.status !== 0) fail(`installed agentctl failed to run: ${(verify.stderr || verify.stdout || "").slice(0, 500)}`);
    try {
      readConfig(configPath);
    } catch {
      fail(`installed config is not valid JSONC: ${configPath}`);
    }
  }

  console.log(`AgentOps global rules v${VERSION}${dryRun ? " (dry run)" : ""}`);
  console.log(`target: ${target}`);
  console.log(
    `OpenCode: ${opencode.generation}${opencode.detected ? ` (${String(opencode.source).split(/\r?\n/)[0]})` : " (forced)"}`,
  );
  console.log(`AGENTS.md: managed block ${existingAgents.includes(BEGIN) ? "updated" : "installed"}`);
  console.log(`instructions: ${instructionFiles.length} file(s) (${instructionMerge.removed} legacy path(s) replaced)`);
  console.log(`agentctl: ${binFiles.length} file(s)`);
  if (opencode.generation === "v1") {
    console.log(
      `permission: V1 shell rules (${permissionMerge.rules})${permissionMerge.hadPermissionsArray ? "; removed unsupported V2 permissions array" : ""}`,
    );
    if (permissionMerge.skipped) console.log(`permission note: ${permissionMerge.skipped}`);
  } else {
    console.log(
      `permissions: V2 array (+${permissionMerge.added})${permissionMerge.legacyPermission ? "; existing V1 permission object left in place (deprecated)" : ""}`,
    );
  }
  if (backedUp > 0) console.log(`backups: ${backedUp} file(s) under ${backupRoot}`);
  else if (!dryRun && !noBackup) console.log("backups: none needed");
  if (dryRun) console.log("dry run: no files were written");
  else console.log("verify: agentctl help answered; config parsed");
  if (!dryRun) {
    console.log("");
    console.log("Next: restart OpenCode and start a fresh session.");
    console.log("Confirm with: \"What is your waiting/status protocol?\" and \"Which branches may trigger Vercel deployments?\"");
  }

  if (flags["run-tests"] && !dryRun) {
    console.log("");
    console.log("Running AgentOps reliability suite (this takes a few minutes)...");
    const tests = spawnSync(
      process.execPath,
      ["--test", path.join(target, "bin", "orchestrator.test.mjs"), path.join(target, "bin", "agentctl.test.mjs")],
      { stdio: "inherit", cwd: target },
    );
    if (tests.status !== 0) fail("installed reliability suite failed");
    console.log("reliability suite passed");
  }
}

main();
