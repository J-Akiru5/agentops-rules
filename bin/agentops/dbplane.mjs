/**
 * Database plane.
 *
 * The mission authorizes ordinary development migrations. This module does not trust the caller:
 * it resolves the configured environment identity from plan/policy.yaml, verifies the target is the
 * designated development project (never production), takes an exclusive `db-dev` lease, runs the
 * repository's migration command, and records the evidence. The connection string is never printed.
 *
 * Repository reality: the policy supplies the migration command; this module has no project-specific
 * paths. The reference project uses a Node/pg migration runner (no supabase/config.toml), so the
 * default tool is db_migrate; supabase db push remains a policy option for repos that configure it.
 */
import fs from "node:fs";
import path from "node:path";
import { acquireLock, releaseLock } from "./state.mjs";
import { Refusal, runCommand } from "./runner.mjs";

function readEnvValue(envFile, key) {
  if (!fs.existsSync(envFile)) return null;
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

function identityOf(connectionString) {
  try {
    const parsed = new URL(connectionString.replace(/^postgres(ql)?:/, "postgres:"));
    const username = decodeURIComponent(parsed.username || "");
    return {
      host: parsed.hostname || null,
      username,
      // Supabase pooler URLs carry the project ref in the username: postgres.<ref>@<host>
      identity: `${username}@${parsed.hostname}`,
    };
  } catch {
    return null;
  }
}

export function databaseTarget(repo, policy) {
  const config = policy.database ?? {};
  const envFile = path.resolve(repo, config.env_file ?? "apps/web/.env.local");
  const rawUrl = readEnvValue(envFile, "SUPABASE_DB_URL") ?? readEnvValue(envFile, "DATABASE_URL");
  if (!rawUrl) {
    return { ok: false, reason: `no SUPABASE_DB_URL/DATABASE_URL found in ${config.env_file}`, config, envFile };
  }
  const identity = identityOf(rawUrl);
  if (!identity || !identity.host) {
    return { ok: false, reason: "database URL could not be parsed", config, envFile };
  }
  if (!config.dev_project_ref) {
    return { ok: false, reason: "policy.database.dev_project_ref is not configured; refusing to guess", config, envFile };
  }
  for (const productionRef of config.production_project_refs ?? []) {
    if (productionRef && identity.identity.includes(productionRef)) {
      return { ok: false, reason: "database target matches a configured production project ref", config, envFile, host: identity.host };
    }
  }
  if (!identity.identity.includes(config.dev_project_ref)) {
    return {
      ok: false,
      reason: `database target does not contain the configured dev project ref (${config.dev_project_ref}) in its host or username`,
      config,
      envFile,
      host: identity.host,
    };
  }
  if (/\bprod(uction)?\b/i.test(identity.identity)) {
    return { ok: false, reason: "database target looks like production", config, envFile, host: identity.host };
  }
  return { ok: true, host: identity.host, username: identity.username, config, envFile };
}

export async function runDevelopmentMigration(ctx) {
  const { db, repo, commonDir, policy, agent, taskId = null } = ctx;
  const config = policy.database ?? {};
  const command = config.migrate_command;
  if (!command) {
    throw new Refusal("policy.database.migrate_command is not configured");
  }
  const target = databaseTarget(repo, policy);
  if (!target.ok) {
    throw new Refusal(`database target not verified: ${target.reason}`);
  }

  const lock = acquireLock(db, {
    name: "db-dev",
    owner: `${agent}:${taskId ?? "manual"}`,
    ttlSeconds: (config.lease_minutes ?? 30) * 60,
    purpose: `migration ${taskId ?? "(manual)"}`,
  });

  try {
    const result = await runCommand(db, repo, commonDir, {
      taskId,
      agent,
      resourceClass: config.resource_class ?? "light",
      command,
      label: `db-migrate-${taskId ?? "manual"}`,
      cwd: repo,
    });

    let verify = null;
    if (config.verify_command && result.exitCode === 0) {
      verify = await runCommand(db, repo, commonDir, {
        taskId,
        agent,
        resourceClass: config.resource_class ?? "light",
        command: config.verify_command,
        label: `db-verify-${taskId ?? "manual"}`,
        cwd: repo,
      });
    }

    return {
      target: { projectRef: config.dev_project_ref, host: target.host },
      migrate: result,
      verify,
      ok: result.exitCode === 0 && (verify === null || verify.exitCode === 0),
    };
  } finally {
    releaseLock(db, "db-dev", `${agent}:${taskId ?? "manual"}`);
  }
}

export function databaseStatus(repo, policy) {
  const target = databaseTarget(repo, policy);
  return {
    tool: policy.database?.tool ?? "db_migrate",
    configuredProjectRef: policy.database?.dev_project_ref ?? null,
    productionRefs: policy.database?.production_project_refs ?? [],
    envFile: policy.database?.env_file ?? null,
    verified: target.ok,
    reason: target.ok ? null : target.reason,
    host: target.host ?? null,
    migrateCommand: policy.database?.migrate_command ?? null,
  };
}
