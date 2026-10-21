/**
 * Reliability suite for agentctl.
 *
 * Every test builds disposable Git repositories under the OS temp directory. No test touches the
 * real Lagavista repository, its worktrees, its database, or any network service.
 *
 * Run: node --test ~/.config/opencode/bin/agentctl.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { openState, updateTask } from "./agentops/state.mjs";

const AGENTCTL = fileURLToPath(new URL("./agentctl.mjs", import.meta.url));
const KEEP = process.env.AGENTOPS_TEST_KEEP === "1";
const BASE_ENV = { ...process.env, NODE_NO_WARNINGS: "1" };
delete BASE_ENV.AGENT_ID;
delete BASE_ENV.AGENTOPS_RESOURCE_LEVEL_OVERRIDE;

/* ------------------------------------------------------------------ helpers */

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function agentctl(repo, args, { env = {}, timeout = 120000 } = {}) {
  return spawnSync(process.execPath, [AGENTCTL, ...args, "--repo", repo], {
    encoding: "utf8",
    timeout,
    env: { ...BASE_ENV, ...env },
  });
}

function agentctlAsync(repo, args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [AGENTCTL, ...args, "--repo", repo], {
      env: { ...BASE_ENV, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

function assertOk(result, label) {
  assert.equal(result.status, 0, `${label} failed (exit ${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function assertRefused(result, label, pattern = null) {
  assert.equal(result.status, 3, `${label} should refuse with exit 3, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  if (pattern) assert.match(result.stderr + result.stdout, pattern, `${label} refusal message`);
  return result;
}

function writePolicy(repo) {
  return `version: 1

integration:
  target_branch: develop
  remote: origin
  protected_branches:
    - main
    - staging
  require_source_on_remote: true
  allow_agents:
    - integrator
    - lead

claims:
  lease_minutes: 15

amendments:
  tiers:
    objective_changed: 3
    acceptance_changed: 3
    check_downgraded: 3
    acceptance_added: 1
    scope_narrowed: 1
    scope_widened: 2
    ownership_changed: 2
    dependencies_added: 1
    dependencies_removed: 3
    verification_changed: 2
    interface_changed: 2
    migration_additive: 2
    migration_non_additive: 3
    default: 2
  tier2_requires_role: lead

verification:
  profiles:
    docs:
      resource_class: light
      commands:
        - node scripts/agentops/noop.mjs
    failing:
      resource_class: light
      commands:
        - node scripts/agentops/fail.mjs
    flaky:
      resource_class: light
      commands:
        - node scripts/agentops/flaky.mjs
    moderate-pass:
      resource_class: moderate
      commands:
        - node scripts/agentops/noop.mjs

resources:
  classes: [light, moderate, heavy]
  exclusive: []

database:
  tool: db_migrate
  dev_project_ref: devref123
  production_project_refs: [prodref456]
  env_file: apps/web/.env.local
  migrate_command: node scripts/agentops/marker.mjs
  verify_command: null
  lease_minutes: 30
  resource_class: light

cleanup:
  require_apply_flag: true
`;
}

function taskContract(id, overrides = {}) {
  const values = {
    title: `Fixture ${id}`,
    milestone: "M01",
    priority: "P1",
    status: "ready",
    dependencies: [],
    ownership: ["work.txt"],
    out_of_scope: ["apps/**"],
    profile: "docs",
    acceptance: ['AC1 [test]: work.txt changes are present'],
    ...overrides,
  };
  return `---
id: ${id}
title: "${values.title}"
milestone: ${values.milestone}
priority: ${values.priority}
status: ${values.status}
rev: 1
objective: "Fixture objective for ${id}"
outcome: "Fixture outcome for ${id}"
verification_profile: ${values.profile}
integration_target: develop
dependencies: [${values.dependencies.join(", ")}]
ownership:
${values.ownership.map((entry) => `  - "${entry}"`).join("\n")}
out_of_scope:
${values.out_of_scope.map((entry) => `  - "${entry}"`).join("\n")}
interfaces: []
deliverables:
  - "work.txt"
acceptance:
${values.acceptance.map((entry) => `  - "${entry}"`).join("\n")}
constraints_security:
  - "no production access"
constraints_compatibility:
  - "no behavior change"
database_migration: none
escalation:
  - "owner decision if blocked"
---
# Context

Fixture contract.
`;
}

function scaffoldPlan(repo, { tasks = null } = {}) {
  const plan = path.join(repo, "plan");
  fs.mkdirSync(path.join(plan, "milestones"), { recursive: true });
  fs.mkdirSync(path.join(plan, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(plan, "amendments"), { recursive: true });
  fs.mkdirSync(path.join(plan, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(repo, "knowledge", "decisions"), { recursive: true });
  fs.mkdirSync(path.join(repo, "scripts", "agentops"), { recursive: true });
  fs.writeFileSync(path.join(plan, "PROJECT.md"), "# Fixture project\n", "utf8");
  fs.writeFileSync(path.join(plan, "policy.yaml"), writePolicy(repo), "utf8");
  fs.writeFileSync(
    path.join(plan, "milestones", "M01-fixture.md"),
    '---\nid: M01\ntitle: "Fixture milestone"\nstatus: active\nowner: human\n---\n\n# Fixture milestone\n',
    "utf8",
  );
  const contracts = tasks ?? [
    ["T-0001", {}],
    ["T-0002", { dependencies: ["T-0001"] }],
    ["T-0003", {}],
  ];
  for (const [id, overrides] of contracts) {
    fs.writeFileSync(path.join(plan, "tasks", `${id}-fixture.md`), taskContract(id, overrides), "utf8");
  }
  fs.writeFileSync(path.join(repo, "scripts", "agentops", "noop.mjs"), "process.exit(0);\n", "utf8");
  fs.writeFileSync(path.join(repo, "scripts", "agentops", "fail.mjs"), "process.exit(1);\n", "utf8");
  fs.writeFileSync(
    path.join(repo, "scripts", "agentops", "flaky.mjs"),
    [
      'import fs from "node:fs";',
      "const file = process.env.AGENTOPS_FLAKY_FILE;",
      "const count = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;",
      "fs.writeFileSync(file, String(count + 1));",
      "process.exit(count === 0 ? 0 : 1);",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "scripts", "agentops", "marker.mjs"),
    'import fs from "node:fs";\nfs.writeFileSync("db-ran.txt", "x");\n',
    "utf8",
  );
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Fixture agent rules\n", "utf8");
}

function makeRepo({ remote = true, tasks = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentops-test-"));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, ["init", "-b", "develop"]);
  git(repo, ["config", "user.email", "agentops-tests@example.local"]);
  git(repo, ["config", "user.name", "AgentOps Tests"]);
  scaffoldPlan(repo, { tasks });
  fs.writeFileSync(path.join(repo, "work.txt"), "base\n", "utf8");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "chore: fixture plan"]);

  let remotePath = null;
  if (remote) {
    remotePath = path.join(root, "remote.git");
    execFileSync("git", ["init", "--bare", remotePath], { stdio: "ignore" });
    git(repo, ["remote", "add", "origin", remotePath]);
    git(repo, ["push", "-u", "origin", "develop"]);
  }

  const feature = () => {
    git(repo, ["checkout", "-b", "feature/t1", "develop"]);
    fs.writeFileSync(path.join(repo, "work.txt"), "base\nfeature\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "feat: fixture work"]);
  };

  const cleanup = () => {
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, repo, remotePath, feature, cleanup };
}

function statusOf(repo, env = {}) {
  const result = assertOk(agentctl(repo, ["status", "--json"], { env }), "status");
  return JSON.parse(result.stdout);
}

/* -------------------------------------------------------------------- tests */

test("plan validate accepts a complete plan and rejects an incomplete contract", () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "validate", "--plan-source", "worktree"]), "valid plan");
    const taskFile = path.join(fixture.repo, "plan", "tasks", "T-0002-fixture.md");
    const broken = fs.readFileSync(taskFile, "utf8").replace(/\nacceptance:[\s\S]*?\nconstraints_security:/, "\nacceptance: []\nconstraints_security:");
    fs.writeFileSync(taskFile, broken, "utf8");
    assertRefused(agentctl(fixture.repo, ["plan", "validate", "--plan-source", "worktree"]), "broken contract", /acceptance/);
  } finally {
    fixture.cleanup();
  }
});

test("concurrent claims: exactly one agent wins the same task", async () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    const [a, b] = await Promise.all([
      agentctlAsync(fixture.repo, ["claim", "T-0001", "--agent", "agent-a", "--branch", "feature/a", "--lease-seconds", "120"]),
      agentctlAsync(fixture.repo, ["claim", "T-0001", "--agent", "agent-b", "--branch", "feature/b", "--lease-seconds", "120"]),
    ]);
    const codes = [a.status, b.status].sort();
    assert.deepEqual(codes, [0, 3], `expected one winner and one refusal, got ${codes}\nA:${a.stderr}\nB:${b.stderr}`);
  } finally {
    fixture.cleanup();
  }
});

test("claim refuses unmet dependencies and overlapping ownership", () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    assertRefused(agentctl(fixture.repo, ["claim", "T-0002", "--agent", "agent-a", "--branch", "feature/a"]), "dependency gate", /dependency T-0001/);
    assertOk(agentctl(fixture.repo, ["claim", "T-0001", "--agent", "agent-a", "--branch", "feature/a"]), "claim T-0001");
    assertRefused(agentctl(fixture.repo, ["claim", "T-0003", "--agent", "agent-b", "--branch", "feature/b"]), "ownership gate", /ownership overlaps/);
  } finally {
    fixture.cleanup();
  }
});

test("stale lease: expired owner cannot write; new owner recovers without touching work", async () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    assertOk(agentctl(fixture.repo, ["claim", "T-0001", "--agent", "agent-old", "--branch", "feature/old", "--lease-seconds", "1"]), "old claim");
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assertOk(agentctl(fixture.repo, ["claim", "T-0001", "--agent", "agent-new", "--branch", "feature/new", "--lease-seconds", "120"]), "takeover");
    assertRefused(agentctl(fixture.repo, ["renew", "T-0001", "--agent", "agent-old"]), "stale renew", /owned by agent-new/);
    assertRefused(agentctl(fixture.repo, ["journal", "T-0001", "--agent", "agent-old", "-m", "late write"]), "stale journal", /owned by agent-new/);
    const status = statusOf(fixture.repo);
    const task = status.tasks.find((row) => row.id === "T-0001");
    assert.equal(task.state, "claimed");
    assert.equal(task.owner, "agent-new");
  } finally {
    fixture.cleanup();
  }
});

test("amendment CAS: concurrent proposals on the same revision — exactly one applies", async () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    const wtA = path.join(fixture.root, "wt-a");
    const wtB = path.join(fixture.root, "wt-b");
    git(fixture.repo, ["worktree", "add", wtA, "-b", "feature/am-a", "develop"]);
    git(fixture.repo, ["worktree", "add", wtB, "-b", "feature/am-b", "develop"]);
    const original = fs.readFileSync(path.join(fixture.repo, "plan", "tasks", "T-0001-fixture.md"), "utf8");
    const proposed = original.replace(
      "constraints_security:",
      '  - "AC9 [test]: amendment addition from a concurrent agent"\nconstraints_security:',
    );
    const proposalA = path.join(fixture.root, "proposal-a.md");
    const proposalB = path.join(fixture.root, "proposal-b.md");
    fs.writeFileSync(proposalA, proposed, "utf8");
    fs.writeFileSync(proposalB, proposed, "utf8");
    const run = (worktree, file, agent) =>
      agentctlAsync(worktree, ["amend", "T-0001", "--agent", agent, "--contract", file, "--title", `Add AC (${agent})`, "--evidence", "unit test race", "--tier", "1", "--plan-source", "worktree"]);
    const [a, b] = await Promise.all([run(wtA, proposalA, "agent-a"), run(wtB, proposalB, "agent-b")]);
    const codes = [a.status, b.status].sort();
    assert.deepEqual(codes, [0, 3], `expected one amendment winner, got ${codes}\nA:${a.stderr}\nB:${b.stderr}`);
    assert.match((a.status === 3 ? a.stderr : b.stderr), /stale amendment/);
    const status = statusOf(fixture.repo);
    const task = status.tasks.find((row) => row.id === "T-0001");
    assert.equal(task.rev, 2);
  } finally {
    fixture.cleanup();
  }
});

test("amendment tier gate: weakening acceptance requires human authorization", () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    const original = fs.readFileSync(path.join(fixture.repo, "plan", "tasks", "T-0001-fixture.md"), "utf8");
    const weakened = original.replace("work.txt changes are present", "work.txt might be present");
    const proposal = path.join(fixture.root, "weakened.md");
    fs.writeFileSync(proposal, weakened, "utf8");
    const refused = assertRefused(
      agentctl(fixture.repo, ["amend", "T-0001", "--agent", "agent-a", "--contract", proposal, "--title", "Weaken AC", "--evidence", "none", "--plan-source", "worktree"]),
      "tier 3 proposal",
      /tier 3 amendment requires human authorization/,
    );
    assert.match(refused.stderr, /awaiting_human/);
    const unchanged = fs.readFileSync(path.join(fixture.repo, "plan", "tasks", "T-0001-fixture.md"), "utf8");
    assert.equal(unchanged, original, "contract must not change without authorization");
    assertOk(
      agentctl(fixture.repo, ["amend", "T-0001", "--agent", "agent-a", "--contract", proposal, "--title", "Weaken AC", "--evidence", "owner chat 2026-10-20", "--human-ref", "owner-chat-2026-10-20", "--plan-source", "worktree"]),
      "human-approved amendment",
    );
    const updated = fs.readFileSync(path.join(fixture.repo, "plan", "tasks", "T-0001-fixture.md"), "utf8");
    assert.match(updated, /rev: 2/);
    const status = statusOf(fixture.repo);
    assert.equal(status.tasks.find((row) => row.id === "T-0001").rev, 2);
  } finally {
    fixture.cleanup();
  }
});

test("verify/submit: evidence is tree-bound; stale evidence and out-of-scope diffs are refused", () => {
  const fixture = makeRepo();
  try {
    fixture.feature();
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    assertOk(agentctl(fixture.repo, ["claim", "T-0001", "--agent", "impl-1", "--branch", "feature/t1"]), "claim");
    assertOk(agentctl(fixture.repo, ["verify", "T-0001", "--agent", "impl-1", "--profile", "docs"]), "verify");

    fs.appendFileSync(path.join(fixture.repo, "work.txt"), "second change\n");
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["commit", "-m", "feat: extra change"]);
    const stale = assertRefused(agentctl(fixture.repo, ["submit", "T-0001", "--agent", "impl-1"]), "stale evidence", /no passing evidence/);

    assertOk(agentctl(fixture.repo, ["verify", "T-0001", "--agent", "impl-1", "--profile", "docs"]), "verify again");
    fs.writeFileSync(path.join(fixture.repo, "outside.txt"), "scope violation\n");
    git(fixture.repo, ["add", "-A"]);
    git(fixture.repo, ["commit", "-m", "feat: outside scope"]);
    assertOk(agentctl(fixture.repo, ["verify", "T-0001", "--agent", "impl-1", "--profile", "docs"]), "verify with violation");
    assertOk(agentctl(fixture.repo, ["checkpoint", "T-0001", "--agent", "impl-1", "--push"]), "push branch");
    assertRefused(agentctl(fixture.repo, ["submit", "T-0001", "--agent", "impl-1"]), "scope gate", /outside ownership/);
  } finally {
    fixture.cleanup();
  }
});

test("integration: verified task advances develop, pushes origin, and is done", () => {
  const fixture = makeRepo();
  try {
    fixture.feature();
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    assertOk(agentctl(fixture.repo, ["agent", "register", "--id", "integrator-1", "--role", "integrator"]), "register");
    assertOk(agentctl(fixture.repo, ["claim", "T-0001", "--agent", "impl-1", "--branch", "feature/t1"]), "claim");
    assertOk(agentctl(fixture.repo, ["verify", "T-0001", "--agent", "impl-1", "--profile", "docs"]), "verify");
    assertOk(agentctl(fixture.repo, ["checkpoint", "T-0001", "--agent", "impl-1", "--push"]), "push");
    assertOk(agentctl(fixture.repo, ["submit", "T-0001", "--agent", "impl-1"]), "submit");
    const before = git(fixture.repo, ["rev-parse", "develop"]);
    const integrated = assertOk(agentctl(fixture.repo, ["integrate", "T-0001", "--agent", "integrator-1", "--plan-source", "worktree"]), "integrate");
    const after = git(fixture.repo, ["rev-parse", "develop"]);
    assert.notEqual(after, before);
    const remoteDevelop = execFileSync("git", ["--git-dir", fixture.remotePath, "rev-parse", "develop"], { encoding: "utf8" }).trim();
    assert.equal(remoteDevelop, after, "origin/develop must point at the integrated commit");
    assert.match(integrated.stdout, /remote: verified/);
    const status = statusOf(fixture.repo);
    assert.equal(status.tasks.find((row) => row.id === "T-0001").state, "done");
    assert.equal(status.tasks.find((row) => row.id === "T-0001").integrated, after);
    const evidenceOnDevelop = execFileSync(
      "git",
      ["-C", fixture.repo, "show", "develop:plan/evidence/T-0001.md"],
      { encoding: "utf8" },
    );
    assert.match(evidenceOnDevelop, /# Evidence — T-0001/);
  } finally {
    fixture.cleanup();
  }
});

test("integration failure: failed candidate verification leaves develop untouched and marks the task", () => {
  const fixture = makeRepo({ tasks: [["T-0005", { profile: "flaky" }]] });
  try {
    fixture.feature();
    const flakyFile = path.join(fixture.root, "flaky-count.txt");
    const env = { AGENTOPS_FLAKY_FILE: flakyFile };
    assertOk(agentctl(fixture.repo, ["plan", "sync"], { env }), "sync");
    assertOk(agentctl(fixture.repo, ["agent", "register", "--id", "integrator-1", "--role", "integrator"], { env }), "register");
    assertOk(agentctl(fixture.repo, ["claim", "T-0005", "--agent", "impl-1", "--branch", "feature/t1"], { env }), "claim");
    assertOk(agentctl(fixture.repo, ["verify", "T-0005", "--agent", "impl-1", "--profile", "flaky"], { env }), "verify passes first run");
    assertOk(agentctl(fixture.repo, ["checkpoint", "T-0005", "--agent", "impl-1", "--push"], { env }), "push");
    assertOk(agentctl(fixture.repo, ["submit", "T-0005", "--agent", "impl-1"], { env }), "submit");
    const before = git(fixture.repo, ["rev-parse", "develop"]);
    assertRefused(agentctl(fixture.repo, ["integrate", "T-0005", "--agent", "integrator-1", "--plan-source", "worktree"], { env }), "integration failure", /verification failed/);
    assert.equal(git(fixture.repo, ["rev-parse", "develop"]), before, "develop must not move on failure");
    const status = statusOf(fixture.repo, env);
    assert.equal(status.tasks.find((row) => row.id === "T-0005").state, "integration_failed");
  } finally {
    fixture.cleanup();
  }
});

test("stale plan read: checkout edits do not change the authoritative develop view", () => {
  const fixture = makeRepo();
  try {
    fs.appendFileSync(path.join(fixture.repo, "plan", "PROJECT.md"), "\nLOCAL UNCOMMITTED EDIT\n");
    const fromDevelop = assertOk(agentctl(fixture.repo, ["plan", "show", "--file", "plan/PROJECT.md"]), "ref read");
    assert.doesNotMatch(fromDevelop.stdout, /LOCAL UNCOMMITTED EDIT/);
    const fromWorktree = assertOk(agentctl(fixture.repo, ["plan", "show", "--file", "plan/PROJECT.md", "--plan-source", "worktree"]), "worktree read");
    assert.match(fromWorktree.stdout, /LOCAL UNCOMMITTED EDIT/);
  } finally {
    fixture.cleanup();
  }
});

test("cleanup refuses dirty, claimed, or unrecorded worktrees; removes only verified-disposable ones", () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");

    const dirtyTree = path.join(fixture.root, "wt-dirty");
    git(fixture.repo, ["worktree", "add", dirtyTree, "-b", "feature/dirty", "develop"]);
    fs.writeFileSync(path.join(dirtyTree, "uncommitted.txt"), "precious\n");

    const claimedTree = path.join(fixture.root, "wt-claimed");
    git(fixture.repo, ["worktree", "add", claimedTree, "-b", "feature/claimed", "develop"]);
    assertOk(agentctl(claimedTree, ["claim", "T-0001", "--agent", "agent-a", "--branch", "feature/claimed"]), "claim in worktree");

    const cleanTree = path.join(fixture.root, "wt-clean");
    git(fixture.repo, ["worktree", "add", cleanTree, "-b", "feature/clean", "develop"]);
    fs.writeFileSync(path.join(cleanTree, "clean.txt"), "done\n");
    git(cleanTree, ["add", "-A"]);
    git(cleanTree, ["commit", "-m", "feat: clean work"]);
    git(cleanTree, ["push", "-u", "origin", "feature/clean"]);
    const { db } = openState(fixture.repo);
    updateTask(db, "T-0001", { state: "done", branch: "feature/clean" });
    db.close();

    const dry = assertOk(agentctl(fixture.repo, ["cleanup", "--json"]), "cleanup dry run");
    const rows = JSON.parse(dry.stdout);
    const dirtyRow = rows.find((row) => row.path.endsWith("wt-dirty"));
    const claimedRow = rows.find((row) => row.path.endsWith("wt-claimed"));
    const cleanRow = rows.find((row) => row.path.endsWith("wt-clean"));
    assert.equal(dirtyRow.removable, false);
    assert.match(dirtyRow.reasons.join(" "), /uncommitted work/);
    assert.equal(claimedRow.removable, false);
    assert.match(claimedRow.reasons.join(" "), /active claim/);
    assert.equal(cleanRow.removable, true);

    assertOk(agentctl(fixture.repo, ["cleanup", "--apply"]), "cleanup apply");
    assert.equal(fs.existsSync(dirtyTree), true, "dirty worktree must survive");
    assert.equal(fs.existsSync(claimedTree), true, "claimed worktree must survive");
    assert.equal(fs.existsSync(cleanTree), false, "clean integrated worktree should be removed");
  } finally {
    fixture.cleanup();
  }
});

test("database guard: target identity is verified before any migration command runs", () => {
  const fixture = makeRepo();
  try {
    fs.mkdirSync(path.join(fixture.repo, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.repo, "apps", "web", ".env.local"),
      "SUPABASE_DB_URL=postgresql://postgres.devref123:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres\n",
      "utf8",
    );
    const okStatus = assertOk(agentctl(fixture.repo, ["db", "status"]), "db status dev");
    assert.match(okStatus.stdout, /target verified: true/);
    assertOk(agentctl(fixture.repo, ["db", "push", "--agent", "agent-a"]), "db push dev");
    assert.equal(fs.existsSync(path.join(fixture.repo, "db-ran.txt")), true);

    fs.rmSync(path.join(fixture.repo, "db-ran.txt"));
    fs.writeFileSync(
      path.join(fixture.repo, "apps", "web", ".env.local"),
      "SUPABASE_DB_URL=postgresql://postgres.prodref456:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres\n",
      "utf8",
    );
    assertRefused(agentctl(fixture.repo, ["db", "status"]), "db status production", /production/);
    assertRefused(agentctl(fixture.repo, ["db", "push", "--agent", "agent-a"]), "db push production", /not verified/);
    assert.equal(fs.existsSync(path.join(fixture.repo, "db-ran.txt")), false, "migration command must not run");

    fs.writeFileSync(
      path.join(fixture.repo, "apps", "web", ".env.local"),
      "SUPABASE_DB_URL=postgresql://postgres.unknown:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres\n",
      "utf8",
    );
    assertRefused(agentctl(fixture.repo, ["db", "push", "--agent", "agent-a"]), "db push unknown", /not verified/);
    assert.equal(fs.existsSync(path.join(fixture.repo, "db-ran.txt")), false);
  } finally {
    fixture.cleanup();
  }
});

test("resource admission: moderate work is refused under a red level while light work passes", () => {
  const fixture = makeRepo();
  try {
    fixture.feature();
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    assertOk(agentctl(fixture.repo, ["claim", "T-0001", "--agent", "impl-1", "--branch", "feature/t1"]), "claim");
    const red = { AGENTOPS_RESOURCE_LEVEL_OVERRIDE: "red" };
    const refused = assertRefused(agentctl(fixture.repo, ["verify", "T-0001", "--agent", "impl-1", "--profile", "moderate-pass"], { env: red }), "moderate under red", /resource level is red/);
    assert.match(refused.stderr, /deferral|deferred/i);
    const afterRefusal = statusOf(fixture.repo, red);
    const deferredTask = afterRefusal.tasks.find((row) => row.id === "T-0001");
    assert.match(deferredTask.blocked, /deferred/i, "resource deferral must be recorded on the task");
    assert.ok(["claimed", "in_progress"].includes(deferredTask.state), "state must not be marked failed");
    assertOk(agentctl(fixture.repo, ["verify", "T-0001", "--agent", "impl-1", "--profile", "docs"], { env: red }), "light under red");
  } finally {
    fixture.cleanup();
  }
});

test("integration resource deferral leaves develop untouched and the task submitted", () => {
  const fixture = makeRepo({ tasks: [["T-0010", { profile: "moderate-pass" }]] });
  try {
    fixture.feature();
    const green = { AGENTOPS_RESOURCE_LEVEL_OVERRIDE: "green" };
    const red = { AGENTOPS_RESOURCE_LEVEL_OVERRIDE: "red" };
    assertOk(agentctl(fixture.repo, ["plan", "sync"], { env: green }), "sync");
    assertOk(agentctl(fixture.repo, ["agent", "register", "--id", "integrator-1", "--role", "integrator"], { env: green }), "register");
    assertOk(agentctl(fixture.repo, ["claim", "T-0010", "--agent", "impl-1", "--branch", "feature/t1"], { env: green }), "claim");
    assertOk(agentctl(fixture.repo, ["verify", "T-0010", "--agent", "impl-1", "--profile", "moderate-pass"], { env: green }), "verify");
    assertOk(agentctl(fixture.repo, ["checkpoint", "T-0010", "--agent", "impl-1", "--push"], { env: green }), "push");
    assertOk(agentctl(fixture.repo, ["submit", "T-0010", "--agent", "impl-1"], { env: green }), "submit");
    const before = git(fixture.repo, ["rev-parse", "develop"]);
    assertRefused(
      agentctl(fixture.repo, ["integrate", "T-0010", "--agent", "integrator-1", "--plan-source", "worktree"], { env: red }),
      "integration deferral",
      /deferred/i,
    );
    assert.equal(git(fixture.repo, ["rev-parse", "develop"]), before, "develop must not move on a resource deferral");
    const status = statusOf(fixture.repo, red);
    const task = status.tasks.find((row) => row.id === "T-0010");
    assert.equal(task.state, "submitted");
    assert.match(task.blocked, /deferred/i);
  } finally {
    fixture.cleanup();
  }
});

test("database lease: concurrent migrations are serialized", async () => {
  const fixture = makeRepo();
  try {
    const policyPath = path.join(fixture.repo, "plan", "policy.yaml");
    const policy = fs
      .readFileSync(policyPath, "utf8")
      .replace("migrate_command: node scripts/agentops/marker.mjs", "migrate_command: node scripts/agentops/slow-marker.mjs");
    fs.writeFileSync(policyPath, policy);
    fs.writeFileSync(
      path.join(fixture.repo, "scripts", "agentops", "slow-marker.mjs"),
      'import fs from "node:fs";\nsetTimeout(() => { fs.writeFileSync("slow-db-ran.txt", "x"); process.exit(0); }, 2500);\n',
      "utf8",
    );
    fs.mkdirSync(path.join(fixture.repo, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.repo, "apps", "web", ".env.local"),
      "SUPABASE_DB_URL=postgresql://postgres.devref123:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres\n",
      "utf8",
    );

    const first = agentctlAsync(fixture.repo, ["db", "push", "--agent", "agent-a", "--plan-source", "worktree"]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assertRefused(
      agentctl(fixture.repo, ["db", "push", "--agent", "agent-b", "--plan-source", "worktree"]),
      "second migration",
      /lock "db-dev" is held/,
    );
    assertOk(await first, "first migration");
    assert.equal(fs.existsSync(path.join(fixture.repo, "slow-db-ran.txt")), true);
  } finally {
    fixture.cleanup();
  }
});

test("deployment-sensitive claims require deployment metadata", () => {
  const fixture = makeRepo({ tasks: [["T-0009", { ownership: ["apps/web/vercel.json"] }]] });
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    assertRefused(
      agentctl(fixture.repo, ["claim", "T-0009", "--agent", "impl-1", "--branch", "feature/t9"], { env: {} }),
      "claim without deployment metadata",
      /deployment_impact/,
    );
    const taskFile = path.join(fixture.repo, "plan", "tasks", "T-0009-fixture.md");
    const updated = fs
      .readFileSync(taskFile, "utf8")
      .replace(
        "verification_profile: docs",
        'deployment_impact: config\ndeployment_verification: "static config check"\nverification_profile: docs',
      );
    fs.writeFileSync(taskFile, updated, "utf8");
    assertOk(
      agentctl(fixture.repo, ["claim", "T-0009", "--agent", "impl-1", "--branch", "feature/t9", "--plan-source", "worktree"]),
      "claim with deployment metadata",
    );
  } finally {
    fixture.cleanup();
  }
});

test("report and status are generated from state and Git, not model prose", () => {
  const fixture = makeRepo();
  try {
    assertOk(agentctl(fixture.repo, ["plan", "sync"]), "sync");
    const report = assertOk(agentctl(fixture.repo, ["report"]), "report");
    assert.match(report.stdout, /# AgentOps report/);
    assert.match(report.stdout, /origin\/develop/);
    assert.match(report.stdout, /T-0001/);
    const status = statusOf(fixture.repo);
    assert.equal(status.developSynced, true);
    assert.ok(Array.isArray(status.tasks));
  } finally {
    fixture.cleanup();
  }
});
