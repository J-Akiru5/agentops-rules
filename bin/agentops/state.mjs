/**
 * State plane for AgentOps.
 *
 * The database lives in `<git-common-dir>/agentops/state.db`, so every linked worktree of the same
 * repository shares one coordination record, and nothing is checked out or merged by Git.
 *
 * Guarantees this module provides:
 *   - claims are atomic (BEGIN IMMEDIATE + a single active claim check);
 *   - every claim carries a fencing counter; stale owners are rejected after a takeover;
 *   - leases expire without destroying work (the task becomes `stale`, the worktree is untouched);
 *   - evidence is keyed to a tree SHA and can be checked for staleness;
 *   - integration and database work use expiring named locks.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, ANOMALY: 4 };

export function nowIso() {
  return new Date().toISOString();
}

export function addSeconds(seconds, from = new Date()) {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

export function newToken() {
  return randomBytes(12).toString("hex");
}

export function gitCommonDir(repo) {
  const out = execFileSync("git", ["-C", repo, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return path.resolve(repo, out);
}

export function agentopsDirs(repo) {
  const common = gitCommonDir(repo);
  const dir = path.join(common, "agentops");
  const dirs = {
    common,
    dir,
    db: path.join(dir, "state.db"),
    logs: path.join(dir, "logs"),
    journal: path.join(dir, "journal"),
    reports: path.join(dir, "reports"),
  };
  for (const key of ["logs", "journal", "reports"]) fs.mkdirSync(dirs[key], { recursive: true });
  return dirs;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT,
  milestone TEXT,
  priority TEXT,
  contract_rev INTEGER NOT NULL DEFAULT 1,
  contract_status TEXT,
  state TEXT NOT NULL DEFAULT 'ready',
  owner_agent TEXT,
  owner_token TEXT,
  fence INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  worktree TEXT,
  branch TEXT,
  base_commit TEXT,
  head_commit TEXT,
  submitted_commit TEXT,
  submitted_tree TEXT,
  integrated_commit TEXT,
  integration_evidence_id INTEGER,
  profile TEXT,
  target TEXT,
  ownership TEXT,
  dependencies TEXT,
  interfaces TEXT,
  database_migration TEXT,
  blocked_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  fence INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_seconds INTEGER NOT NULL,
  released_at TEXT,
  release_reason TEXT,
  worktree TEXT,
  branch TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_task ON claims(task_id, released_at, expires_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  ts TEXT NOT NULL,
  agent TEXT,
  kind TEXT NOT NULL,
  message TEXT,
  commit_sha TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);

CREATE TABLE IF NOT EXISTS amendments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  base_rev INTEGER NOT NULL,
  new_rev INTEGER NOT NULL,
  tier_floor INTEGER NOT NULL,
  tier INTEGER NOT NULL,
  kind TEXT,
  title TEXT,
  status TEXT NOT NULL,
  proposer TEXT NOT NULL,
  approver TEXT,
  evidence TEXT,
  changes_json TEXT,
  proposed_contract TEXT,
  proposed_path TEXT,
  amendment_path TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS acks (
  task_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  revision INTEGER NOT NULL,
  acked_at TEXT NOT NULL,
  PRIMARY KEY (task_id, agent)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  commit_sha TEXT,
  tree_sha TEXT NOT NULL,
  profile TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  checks_json TEXT,
  logs_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence(task_id, id);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  evidence_id INTEGER,
  command TEXT NOT NULL,
  resource_class TEXT NOT NULL,
  level TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  free_before_mb INTEGER,
  free_min_mb INTEGER,
  free_after_mb INTEGER,
  log_path TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  task_id TEXT,
  owner TEXT,
  resource_class TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  purpose TEXT
);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  agent TEXT,
  message TEXT NOT NULL,
  commit_sha TEXT
);
`;

export class StateRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "StateRefusal";
  }
}

export function openState(repo) {
  const dirs = agentopsDirs(repo);
  const db = new DatabaseSync(dirs.db);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return { db, dirs };
}

export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

export function jsonOrNull(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ agents */

export function registerAgent(db, id, role) {
  const ts = nowIso();
  const existing = db.prepare("SELECT id, role FROM agents WHERE id = ?").get(id);
  if (existing) {
    db.prepare("UPDATE agents SET role = ?, updated_at = ? WHERE id = ?").run(role, ts, id);
  } else {
    db.prepare("INSERT INTO agents (id, role, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      id,
      role,
      ts,
      ts,
    );
  }
  return { id, role };
}

export function getAgent(db, id) {
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) ?? null;
}

export function listAgents(db) {
  return db.prepare("SELECT * FROM agents ORDER BY id").all();
}

/* ------------------------------------------------------------------- tasks */

export function recordEvent(db, { taskId = null, agent = null, kind, message = null, commit = null, data = null }) {
  db.prepare(
    "INSERT INTO events (task_id, ts, agent, kind, message, commit_sha, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(taskId, nowIso(), agent, kind, message, commit, jsonOrNull(data));
}

function contractState(status) {
  if (status === "ready") return "ready";
  if (status === "draft") return "draft";
  if (status === "blocked") return "blocked";
  if (status === "done") return "done";
  if (status === "parked") return "blocked";
  return "draft";
}

/** Inserts or refreshes a task from its contract; runtime fields are preserved. */
export function upsertTaskFromContract(db, contract, { agent = null } = {}) {
  const ts = nowIso();
  const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(contract.id) ?? null;
  const runtime = {
    profile: contract.verification_profile,
    target: contract.integration_target,
    ownership: jsonOrNull(contract.ownership ?? []),
    dependencies: jsonOrNull(contract.dependencies ?? []),
    interfaces: jsonOrNull(contract.interfaces ?? []),
    database_migration: contract.database_migration ?? "none",
  };

  if (!existing) {
    db.prepare(
      `INSERT INTO tasks (id, title, milestone, priority, contract_rev, contract_status, state,
        profile, target, ownership, dependencies, interfaces, database_migration, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contract.id,
      contract.title,
      contract.milestone,
      String(contract.priority),
      Number(contract.rev),
      contract.status,
      contractState(contract.status),
      runtime.profile,
      runtime.target,
      runtime.ownership,
      runtime.dependencies,
      runtime.interfaces,
      runtime.database_migration,
      ts,
    );
    recordEvent(db, { taskId: contract.id, agent, kind: "task_discovered", message: `rev ${contract.rev}` });
    return { inserted: true, revisionChanged: false };
  }

  const revisionChanged = Number(existing.contract_rev) !== Number(contract.rev);
  db.prepare(
    `UPDATE tasks SET title = ?, milestone = ?, priority = ?, contract_rev = ?, contract_status = ?,
       profile = ?, target = ?, ownership = ?, dependencies = ?, interfaces = ?, database_migration = ?,
       updated_at = ? WHERE id = ?`,
  ).run(
    contract.title,
    contract.milestone,
    String(contract.priority),
    Number(contract.rev),
    contract.status,
    runtime.profile,
    runtime.target,
    runtime.ownership,
    runtime.dependencies,
    runtime.interfaces,
    runtime.database_migration,
    ts,
    contract.id,
  );
  if (revisionChanged) {
    recordEvent(db, {
      taskId: contract.id,
      agent,
      kind: "contract_changed",
      message: `revision ${existing.contract_rev} -> ${contract.rev}`,
    });
  }
  return { inserted: false, revisionChanged };
}

export function getTask(db, id) {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) ?? null;
}

export function listTasks(db) {
  return db.prepare("SELECT * FROM tasks ORDER BY id").all();
}

export function updateTask(db, id, fields) {
  const allowed = [
    "state",
    "owner_agent",
    "owner_token",
    "fence",
    "lease_expires_at",
    "worktree",
    "branch",
    "base_commit",
    "head_commit",
    "submitted_commit",
    "submitted_tree",
    "integrated_commit",
    "integration_evidence_id",
    "blocked_reason",
  ];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key));
  if (keys.length === 0) return;
  const assignments = keys.map((key) => `${key} = ?`).join(", ");
  const values = keys.map((key) => (fields[key] === undefined ? null : fields[key]));
  db.prepare(`UPDATE tasks SET ${assignments}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), id);
}

/* ------------------------------------------------------------------ claims */

function activeClaim(db, taskId) {
  return (
    db
      .prepare("SELECT * FROM claims WHERE task_id = ? AND released_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(taskId) ?? null
  );
}

export function expireClaim(db, claim, reason = "lease_expired") {
  db.prepare("UPDATE claims SET released_at = ?, release_reason = ? WHERE id = ?").run(nowIso(), reason, claim.id);
  const task = getTask(db, claim.task_id);
  if (task && task.state !== "integrated" && task.state !== "done") {
    updateTask(db, claim.task_id, {
      state: "stale",
      owner_agent: null,
      owner_token: null,
      lease_expires_at: null,
      blocked_reason: `lease expired (${claim.agent})`,
    });
  }
  recordEvent(db, {
    taskId: claim.task_id,
    agent: claim.agent,
    kind: "lease_expired",
    message: `fence ${claim.fence}; worktree preserved`,
  });
}

/** Reaps expired leases. Never touches worktrees or branches. Submitted work keeps its claim. */
export function reapExpired(db) {
  const now = nowIso();
  const expired = db
    .prepare(
      `SELECT c.*, t.state AS task_state FROM claims c
       JOIN tasks t ON t.id = c.task_id
       WHERE c.released_at IS NULL AND c.expires_at <= ? ORDER BY c.id`,
    )
    .all(now);
  const actionable = expired.filter(
    (claim) => !["submitted", "integrating", "integrated", "done", "cancelled", "superseded"].includes(claim.task_state),
  );
  for (const claim of actionable) expireClaim(db, claim);
  return actionable;
}

export function claimTask(
  db,
  { taskId, agent, worktree, branch, baseCommit, leaseSeconds = 900 },
) {
  return tx(db, () => {
    reapExpired(db);
    const task = getTask(db, taskId);
    if (!task) throw new StateRefusal(`unknown task ${taskId}; run "agentctl plan sync" first`);
    if (!["ready", "stale"].includes(task.state)) {
      throw new StateRefusal(`task ${taskId} is ${task.state}; only ready or stale tasks can be claimed (run plan sync / release)`);
    }
    const existing = activeClaim(db, taskId);
    if (existing) {
      throw new StateRefusal(
        `task ${taskId} is already claimed by ${existing.agent} until ${existing.expires_at} (fence ${existing.fence})`,
      );
    }
    const fence = Number(task.fence) + 1;
    const token = newToken();
    const ts = nowIso();
    const expiresAt = addSeconds(leaseSeconds);
    db.prepare(
      `INSERT INTO claims (task_id, agent, token, fence, acquired_at, expires_at, lease_seconds, worktree, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(taskId, agent, token, fence, ts, expiresAt, leaseSeconds, worktree, branch);
    updateTask(db, taskId, {
      state: "claimed",
      owner_agent: agent,
      owner_token: token,
      fence,
      lease_expires_at: expiresAt,
      worktree,
      branch,
      base_commit: baseCommit,
      blocked_reason: null,
    });
    recordEvent(db, {
      taskId,
      agent,
      kind: "claimed",
      message: `fence ${fence}; branch ${branch}`,
      commit: baseCommit,
    });
    return { token, fence, expiresAt };
  });
}

export function requireOwner(db, taskId, agent) {
  const task = getTask(db, taskId);
  if (!task) throw new StateRefusal(`unknown task ${taskId}`);
  if (task.owner_agent !== agent) {
    throw new StateRefusal(`task ${taskId} is owned by ${task.owner_agent ?? "(nobody)"}, not ${agent}`);
  }
  const claim = activeClaim(db, taskId);
  if (!claim || claim.token !== task.owner_token || claim.released_at !== null) {
    throw new StateRefusal(`task ${taskId}: ownership token is no longer current (fencing rejected)`);
  }
  if (claim.expires_at <= nowIso()) {
    expireClaim(db, claim);
    throw new StateRefusal(`task ${taskId}: lease expired at ${claim.expires_at}; claim it again to continue`);
  }
  return { task, claim };
}

export function renewClaim(db, taskId, agent, leaseSeconds = 900) {
  return tx(db, () => {
    const { claim } = requireOwner(db, taskId, agent);
    const expiresAt = addSeconds(leaseSeconds);
    db.prepare("UPDATE claims SET expires_at = ?, lease_seconds = ? WHERE id = ?").run(
      expiresAt,
      leaseSeconds,
      claim.id,
    );
    updateTask(db, taskId, { lease_expires_at: expiresAt });
    recordEvent(db, { taskId, agent, kind: "lease_renewed", message: `until ${expiresAt}` });
    return { expiresAt, fence: claim.fence };
  });
}

export function releaseClaim(db, taskId, agent, reason = "released") {
  return tx(db, () => {
    const { task, claim } = requireOwner(db, taskId, agent);
    db.prepare("UPDATE claims SET released_at = ?, release_reason = ? WHERE id = ?").run(nowIso(), reason, claim.id);
    const nextState =
      ["submitted", "integrating", "integrated", "done", "cancelled", "superseded"].includes(task.state)
        ? task.state
        : "ready";
    updateTask(db, taskId, { state: nextState, owner_agent: null, owner_token: null, lease_expires_at: null });
    recordEvent(db, { taskId, agent, kind: "released", message: reason });
    return { state: nextState };
  });
}

/* --------------------------------------------------------------- acks */

export function ackContract(db, taskId, agent, revision) {
  const task = getTask(db, taskId);
  if (!task) throw new StateRefusal(`unknown task ${taskId}`);
  if (Number(revision) !== Number(task.contract_rev)) {
    throw new StateRefusal(`cannot ack revision ${revision}; current contract is rev ${task.contract_rev}`);
  }
  db.prepare(
    `INSERT INTO acks (task_id, agent, revision, acked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(task_id, agent) DO UPDATE SET revision = excluded.revision, acked_at = excluded.acked_at`,
  ).run(taskId, agent, Number(revision), nowIso());
  recordEvent(db, { taskId, agent, kind: "acknowledged", message: `rev ${revision}` });
  return { taskId, agent, revision: Number(revision) };
}

export function ackStatus(db, taskId, agent) {
  const task = getTask(db, taskId);
  const ack = db.prepare("SELECT * FROM acks WHERE task_id = ? AND agent = ?").get(taskId, agent) ?? null;
  return {
    contractRev: task?.contract_rev ?? null,
    ackedRev: ack?.revision ?? null,
    current: Boolean(task && ack && Number(ack.revision) === Number(task.contract_rev)),
  };
}

/* --------------------------------------------------------------- evidence */

export function insertEvidence(db, record) {
  const run = db
    .prepare(
      `INSERT INTO evidence (task_id, commit_sha, tree_sha, profile, status, started_at, finished_at,
        checks_json, logs_json, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.taskId,
      record.commit ?? null,
      record.tree,
      record.profile,
      record.status,
      record.startedAt ?? null,
      record.finishedAt ?? null,
      jsonOrNull(record.checks ?? []),
      jsonOrNull(record.logs ?? []),
      record.note ?? null,
      nowIso(),
    );
  return Number(run.lastInsertRowid);
}

export function latestEvidence(db, taskId, profile = null) {
  if (profile) {
    return (
      db
        .prepare("SELECT * FROM evidence WHERE task_id = ? AND profile = ? ORDER BY id DESC LIMIT 1")
        .get(taskId, profile) ?? null
    );
  }
  return db.prepare("SELECT * FROM evidence WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(taskId) ?? null;
}

export function evidenceIsCurrent(db, taskId, profile, treeSha) {
  const evidence = latestEvidence(db, taskId, profile);
  return Boolean(evidence && evidence.status === "pass" && evidence.tree_sha === treeSha);
}

/* ------------------------------------------------------------------- locks */

export function acquireLockInTx(db, { name, owner, ttlSeconds, purpose = null }) {
  const now = nowIso();
  db.prepare("DELETE FROM locks WHERE expires_at <= ?").run(now);
  const current = db.prepare("SELECT * FROM locks WHERE name = ?").get(name) ?? null;
  if (current && current.owner !== owner) {
    throw new StateRefusal(
      `lock "${name}" is held by ${current.owner} until ${current.expires_at}${current.purpose ? ` (${current.purpose})` : ""}`,
    );
  }
  const token = newToken();
  const expiresAt = addSeconds(ttlSeconds);
  if (current) {
    db.prepare("UPDATE locks SET owner = ?, token = ?, acquired_at = ?, expires_at = ?, purpose = ? WHERE name = ?").run(
      owner,
      token,
      now,
      expiresAt,
      purpose,
      name,
    );
  } else {
    db.prepare("INSERT INTO locks (name, owner, token, acquired_at, expires_at, purpose) VALUES (?, ?, ?, ?, ?, ?)").run(
      name,
      owner,
      token,
      now,
      expiresAt,
      purpose,
    );
  }
  return { name, token, expiresAt };
}

export function acquireLock(db, options) {
  return tx(db, () => acquireLockInTx(db, options));
}

export function releaseLock(db, name, owner) {
  return tx(db, () => {
    const current = db.prepare("SELECT * FROM locks WHERE name = ?").get(name) ?? null;
    if (current && current.owner === owner) db.prepare("DELETE FROM locks WHERE name = ?").run(name);
    return { released: Boolean(current && current.owner === owner) };
  });
}

export function listLocks(db) {
  return db.prepare("SELECT * FROM locks ORDER BY name").all();
}

/* ------------------------------------------------------------------ journal */

export function appendJournal(db, { taskId, agent, message, commit = null }) {
  db.prepare("INSERT INTO journal (task_id, ts, agent, message, commit_sha) VALUES (?, ?, ?, ?, ?)").run(
    taskId,
    nowIso(),
    agent,
    message,
    commit,
  );
}
