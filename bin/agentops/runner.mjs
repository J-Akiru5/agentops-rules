/**
 * Resource admission and command execution.
 *
 * Every command runs through an expiring reservation. Admission is advisory at the policy level but
 * deterministic in the database: two concurrent heavy jobs cannot both pass when the measured level
 * offers no heavy slot. Measurements are recorded per command so estimates can be calibrated later.
 *
 * Resource measurement comes from orchestrator.mjs (the existing, tested helper). Peak memory is
 * approximated by sampling Node's view of free system memory while the child runs; it is conservative
 * enough for scheduling but is not a per-process RSS measurement. This limitation is reported.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readResources, resourceAdvice } from "../orchestrator.mjs";
import { addSeconds, insertEvidence, newToken, nowIso, renewClaim, tx } from "./state.mjs";

const MB = 1024 * 1024;
const RESERVATION_TTL_SECONDS = 45 * 60;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export class Refusal extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "Refusal";
    this.details = details;
  }
}

/** A scheduling deferral: the work did not run, but no task state may be marked failed. */
export class ResourceDeferral extends Refusal {
  constructor(message, details = null) {
    super(message, details);
    this.name = "ResourceDeferral";
  }
}

export function measure(repo) {
  const measured = readResources(repo);
  const advice = resourceAdvice(measured);
  return { ...measured, ...advice };
}

function activeReservations(db) {
  const now = nowIso();
  return db.prepare("SELECT * FROM reservations WHERE expires_at > ? ORDER BY id").all(now);
}

/**
 * Reserves capacity for one command. `levelOverride` exists for deterministic tests and is never set
 * by production code paths.
 */
export function admit(db, repo, { taskId = null, agent = null, resourceClass, levelOverride = null }) {
  const resources = measure(repo);
  const level = levelOverride ?? process.env.AGENTOPS_RESOURCE_LEVEL_OVERRIDE ?? resources.level;
  const effective = {
    level,
    heavySlots: level === "red" ? 0 : level === "amber" ? 1 : resources.heavySlots,
    moderateSlots: level === "red" ? 0 : level === "amber" ? 2 : resources.moderateSlots,
  };
  if (resourceClass === "light") {
    // Light work is always admitted; it is the escape hatch under pressure.
  } else if (resourceClass === "moderate") {
    if (effective.level === "red") {
      throw new ResourceDeferral(
        `resource level is red (${resources.reasons.join("; ")}); moderate work is deferred, not failed. Continue with light work or another eligible task and retry later.`,
      );
    }
    const reserved = activeReservations(db).filter((row) => row.resource_class !== "light");
    if (reserved.length >= effective.moderateSlots) {
      throw new ResourceDeferral(
        `moderate slots are full (${reserved.length}/${effective.moderateSlots}); ${reserved
          .map((row) => `${row.resource_class}:${row.task_id ?? row.owner ?? "?"}`)
          .join(", ")}. Deferred, not failed; continue with light work or another eligible task.`,
      );
    }
  } else if (resourceClass === "heavy") {
    if (effective.heavySlots < 1) {
      throw new ResourceDeferral(
        `resource level is ${effective.level} (${resources.reasons.join("; ") || "no heavy slot"}); heavy work is deferred, not failed. Continue with light work or another eligible task and retry later.`,
      );
    }
    const reserved = activeReservations(db).filter((row) => row.resource_class !== "light");
    if (reserved.length >= effective.heavySlots) {
      throw new ResourceDeferral(
        `heavy slots are full (${reserved.length}/${effective.heavySlots}); ${reserved
          .map((row) => `${row.resource_class}:${row.task_id ?? row.owner ?? "?"}`)
          .join(", ")}. Deferred, not failed; continue with light work or another eligible task.`,
      );
    }
  } else {
    throw new Refusal(`unknown resource class: ${resourceClass}`);
  }

  const token = newToken();
  return tx(db, () => {
    const now = nowIso();
    db.prepare("DELETE FROM reservations WHERE expires_at <= ?").run(now);
    db.prepare(
      "INSERT INTO reservations (token, task_id, owner, resource_class, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(token, taskId, agent, resourceClass, now, addSeconds(RESERVATION_TTL_SECONDS));
    return { token, level: effective.level, resources };
  });
}

function releaseReservation(db, token) {
  try {
    db.prepare("DELETE FROM reservations WHERE token = ?").run(token);
  } catch {
    /* ignore */
  }
}

function ensureLogDir(repo, commonDir, taskId, tree) {
  const safeTask = taskId ?? "global";
  const dir = path.join(commonDir, "agentops", "logs", safeTask, tree ? tree.slice(0, 12) : "unversioned");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Runs one shell command under a reservation. Returns exit code, duration, log path and memory
 * observations. A nonzero exit is data, not an exception.
 */
export async function runCommand(
  db,
  repo,
  commonDir,
  {
    taskId = null,
    agent = null,
    resourceClass = "light",
    command,
    label = "command",
    cwd = repo,
    env = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    levelOverride = null,
    tree = null,
  } = {},
) {
  const reservation = admit(db, repo, { taskId, agent, resourceClass, levelOverride });
  const logDir = ensureLogDir(repo, commonDir, taskId, tree);
  const logPath = path.join(logDir, `${stamp()}-${label.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60)}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  stream.write(`# command: ${command}\n# cwd: ${cwd}\n# class: ${resourceClass}\n# level: ${reservation.level}\n\n`);

  const freeBeforeMb = Math.round(os.freemem() / MB);
  let freeMinMb = freeBeforeMb;
  const startedAt = nowIso();
  const started = Date.now();

  const child = spawn(command, {
    cwd,
    shell: true,
    windowsHide: true,
    env: { ...process.env, AGENTOPS: "1", ...env },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  const sampler = setInterval(() => {
    freeMinMb = Math.min(freeMinMb, Math.round(os.freemem() / MB));
  }, 400);

  const heartbeat = setInterval(() => {
    if (!taskId || !agent) return;
    try {
      renewClaim(db, taskId, agent);
    } catch {
      /* heartbeats must not kill the command; ownership failures surface on the next gate */
    }
  }, 60_000);

  const pipe = (data) => stream.write(data);
  child.stdout?.on("data", pipe);
  child.stderr?.on("data", pipe);

  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => {
      stream.write(`\n# spawn error: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", (code, signal) => {
      if (signal) stream.write(`\n# terminated by signal ${signal}\n`);
      resolve(code ?? 124);
    });
  });

  clearInterval(sampler);
  clearInterval(heartbeat);
  clearTimeout(timer);
  const durationMs = Date.now() - started;
  const freeAfterMb = Math.round(os.freemem() / MB);
  stream.write(
    `\n# exit: ${exitCode}${timedOut ? " (timeout)" : ""}\n# duration_ms: ${durationMs}\n# free_mb: before=${freeBeforeMb} min=${freeMinMb} after=${freeAfterMb}\n`,
  );
  await new Promise((resolve) => stream.end(resolve));

  releaseReservation(db, reservation.token);

  const run = db
    .prepare(
      `INSERT INTO runs (task_id, command, resource_class, level, exit_code, duration_ms,
        free_before_mb, free_min_mb, free_after_mb, log_path, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      command,
      resourceClass,
      reservation.level,
      exitCode,
      durationMs,
      freeBeforeMb,
      freeMinMb,
      freeAfterMb,
      logPath,
      startedAt,
      nowIso(),
    );

  return {
    runId: Number(run.lastInsertRowid),
    exitCode,
    durationMs,
    logPath,
    freeBeforeMb,
    freeMinMb,
    freeAfterMb,
    level: reservation.level,
    timedOut,
  };
}

/**
 * Runs a verification profile (all commands from policy) and records one evidence row keyed to the
 * tree under test. Stops at the first failing command.
 */
export async function runProfile(
  db,
  repo,
  commonDir,
  {
    taskId,
    agent,
    profileName,
    profile,
    cwd = repo,
    tree,
    commit,
    note = null,
    levelOverride = null,
    labelPrefix = null,
  },
) {
  if (!profile || !Array.isArray(profile.commands) || profile.commands.length === 0) {
    throw new Refusal(`verification profile "${profileName}" has no commands`);
  }
  const startedAt = nowIso();
  const checks = [];
  const runIds = [];
  let failed = false;

  for (const [index, command] of profile.commands.entries()) {
    const label = `${labelPrefix ?? taskId}-${profileName}-${index + 1}`;
    const result = await runCommand(db, repo, commonDir, {
      taskId,
      agent,
      resourceClass: profile.resource_class ?? "light",
      command,
      label,
      cwd,
      levelOverride,
      tree,
    });
    runIds.push(result.runId);
    checks.push({
      id: `${profileName}:${index + 1}`,
      command,
      exit: result.exitCode,
      durationMs: result.durationMs,
      log: result.logPath,
      level: result.level,
      freeMinMb: result.freeMinMb,
    });
    if (result.exitCode !== 0) {
      failed = true;
      break; // stop early to save resources; the failure is recorded
    }
  }

  const status = failed ? "fail" : "pass";
  const evidenceId = tx(db, () => {
    const id = insertEvidence(db, {
      taskId,
      commit,
      tree,
      profile: profileName,
      status,
      startedAt,
      finishedAt: nowIso(),
      checks,
      logs: checks.map((check) => check.log),
      note,
    });
    for (const runId of runIds) db.prepare("UPDATE runs SET evidence_id = ? WHERE id = ?").run(id, runId);
    return id;
  });

  return { evidenceId, status, checks, tree, commit, profile: profileName };
}
