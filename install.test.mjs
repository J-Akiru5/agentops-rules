import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(ROOT, "install.mjs");
const BEGIN = "<!-- BEGIN agentops-global (managed) -->";
const END = "<!-- END agentops-global (managed) -->";

function install(args) {
  return spawnSync(process.execPath, [INSTALL, ...args], { encoding: "utf8", timeout: 120_000 });
}

function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inString = false;
  let line = false;
  let block = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (line) {
      if (ch === "\n") {
        line = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (block) {
      if (ch === "*" && next === "/") {
        block = false;
        i += 2;
      } else i += 1;
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      line = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      block = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function readConfig(target, name = "opencode.jsonc") {
  return JSON.parse(stripJsonc(fs.readFileSync(path.join(target, name), "utf8")));
}

function tempTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentops-install-"));
}

test("fresh install installs rules, CLI and config and passes a quick verify", () => {
  const target = tempTarget();
  const result = install(["--target", target, "--opencode", "v2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AgentOps global rules/);

  const agents = fs.readFileSync(path.join(target, "AGENTS.md"), "utf8");
  assert.ok(agents.includes(BEGIN) && agents.includes(END));
  assert.match(agents, /Vercel Deployment Governance/);

  for (const name of [
    "autonomous-orchestration.md",
    "agentops-backbone.md",
    "deployment-governance.md",
    "team-development.md",
  ]) {
    assert.ok(fs.existsSync(path.join(target, "instructions", name)), `missing ${name}`);
  }
  assert.ok(fs.existsSync(path.join(target, "bin", "agentctl.mjs")));
  assert.ok(fs.existsSync(path.join(target, "bin", "agentops", "state.mjs")));
  assert.ok(fs.existsSync(path.join(target, "bin", "orchestrator.mjs")));

  const config = readConfig(target);
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.ok(config.instructions.some((entry) => entry.endsWith("/instructions/team-development.md")));
  assert.ok(
    config.permissions.some((entry) => entry.resource === "vercel deploy*" && entry.effect === "ask"),
    "deploy permission missing",
  );

  const help = spawnSync(process.execPath, [path.join(target, "bin", "agentctl.mjs"), "help"], {
    encoding: "utf8",
    cwd: target,
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /AgentOps planning backbone/);
});

test("existing AGENTS.md, config keys and permissions are preserved; install is idempotent", () => {
  const target = tempTarget();
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "AGENTS.md"), "# Personal rules\n\nKeep my own notes.\n", "utf8");
  fs.writeFileSync(
    path.join(target, "opencode.jsonc"),
    `{
  "$schema": "https://opencode.ai/config.json",
  // personal setting
  "model": "example/model",
  "instructions": ["~/custom.md"],
  "permissions": [{ "action": "shell", "resource": "custom command", "effect": "allow" }]
}
`,
    "utf8",
  );

  const first = install(["--target", target, "--opencode", "v2"]);
  assert.equal(first.status, 0, first.stderr);
  const agents = fs.readFileSync(path.join(target, "AGENTS.md"), "utf8");
  assert.match(agents, /# Personal rules/);
  assert.equal((agents.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);

  const config = readConfig(target);
  assert.equal(config.model, "example/model");
  assert.ok(config.instructions.includes("~/custom.md"));
  assert.ok(config.permissions.some((entry) => entry.resource === "custom command"));
  const managedCount = config.permissions.filter((entry) => entry.effect === "ask").length;

  const second = install(["--target", target, "--opencode", "v2"]);
  assert.equal(second.status, 0, second.stderr);
  const agentsAgain = fs.readFileSync(path.join(target, "AGENTS.md"), "utf8");
  assert.equal((agentsAgain.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
  const configAgain = readConfig(target);
  assert.equal(configAgain.permissions.filter((entry) => entry.effect === "ask").length, managedCount);
  assert.equal(new Set(configAgain.instructions).size, configAgain.instructions.length);
  assert.ok(fs.existsSync(path.join(target, ".agentops", "backups")));
});

test("pre-existing identical rules are wrapped without duplication", () => {
  const target = tempTarget();
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "rules", "AGENTS.md"), path.join(target, "AGENTS.md"));
  const result = install(["--target", target, "--opencode", "v2"]);
  assert.equal(result.status, 0, result.stderr);
  const agents = fs.readFileSync(path.join(target, "AGENTS.md"), "utf8");
  assert.equal((agents.match(/Agent Waiting and Status Protocol/g) ?? []).length, 1);
  assert.ok(agents.trimStart().startsWith(BEGIN));
});

test("dry run writes nothing", () => {
  const target = tempTarget();
  const result = install(["--target", target, "--opencode", "v2", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dry run: no files were written/);
  assert.equal(fs.existsSync(path.join(target, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(target, "instructions")), false);
  assert.equal(fs.existsSync(path.join(target, "opencode.jsonc")), false);
});

test("invalid existing config is refused before any write", () => {
  const target = tempTarget();
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "opencode.jsonc"), "{ not valid json", "utf8");
  const result = install(["--target", target, "--opencode", "v2"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot parse/);
  assert.equal(fs.existsSync(path.join(target, "AGENTS.md")), false);
  assert.equal(fs.existsSync(path.join(target, "instructions")), false);
});

test("V1 install writes permission.shell rules and removes the unsupported V2 permissions array", () => {
  const target = tempTarget();
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, "opencode.jsonc"),
    `{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [{ "action": "shell", "resource": "legacy-v2", "effect": "allow" }],
  "permission": { "shell": { "custom *": "allow" }, "edit": "ask" },
  "instructions": ["~/.config/opencode/instructions/agentops-backbone.md"]
}
`,
    "utf8",
  );
  const result = install(["--target", target, "--opencode", "v1"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenCode: v1/);
  const config = readConfig(target);
  assert.equal(Object.hasOwn(config, "permissions"), false, "V2 permissions array must be removed for V1");
  assert.equal(config.permission.edit, "ask");
  assert.equal(config.permission.shell["custom *"], "allow");
  assert.equal(config.permission.shell["vercel deploy*"], "ask");
  assert.equal(config.permission.shell["git push --force*"], "ask");
  assert.ok(config.instructions.every((entry) => !entry.includes("~/")));
  assert.equal(config.instructions.filter((entry) => entry.includes("agentops-backbone.md")).length, 1);
  assert.ok(config.instructions.some((entry) => /\/instructions\/agentops-backbone\.md$/.test(entry)));
});

test("V2 install keeps the ordered permissions array and absolute instruction paths", () => {
  const target = tempTarget();
  const result = install(["--target", target, "--opencode", "v2"]);
  assert.equal(result.status, 0, result.stderr);
  const config = readConfig(target);
  assert.ok(Array.isArray(config.permissions));
  assert.ok(config.permissions.some((entry) => entry.resource === "vercel deploy*" && entry.effect === "ask"));
  assert.ok(config.instructions.every((entry) => entry.startsWith(target.replaceAll("\\", "/"))));
});

