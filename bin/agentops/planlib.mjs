/**
 * Intent plane helpers.
 *
 * Plan files are read through a Git ref (origin/develop by default), never from a possibly stale
 * checkout. `source: "worktree"` exists only for bootstrapping a repository whose plan is not on
 * develop yet and for tests; the CLI prints which source it used.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, parseYaml } from "./yaml.mjs";

export class PlanError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "PlanError";
    this.details = details;
  }
}

export const CONTRACT_REQUIRED = [
  "id",
  "title",
  "milestone",
  "priority",
  "status",
  "rev",
  "objective",
  "outcome",
  "verification_profile",
  "integration_target",
  "dependencies",
  "ownership",
  "out_of_scope",
  "interfaces",
  "deliverables",
  "acceptance",
  "constraints_security",
  "constraints_compatibility",
  "database_migration",
  "escalation",
];

export const CONTRACT_STATUSES = ["draft", "ready", "blocked", "parked", "done"];
export const MIGRATION_KINDS = ["none", "additive", "non_additive"];
export const CHECK_RANK = { review: 1, cmd: 2, test: 3 };

export const DEFAULT_POLICY = {
  version: 1,
  integration: {
    target_branch: "develop",
    remote: "origin",
    protected_branches: ["main", "staging"],
    require_source_on_remote: true,
    allow_agents: ["integrator", "lead"],
  },
  claims: { lease_minutes: 15 },
  amendments: {
    tiers: {
      objective_changed: 3,
      acceptance_changed: 3,
      check_downgraded: 3,
      acceptance_added: 1,
      scope_narrowed: 1,
      scope_widened: 2,
      ownership_changed: 2,
      dependencies_added: 1,
      dependencies_removed: 3,
      verification_changed: 2,
      interface_changed: 2,
      migration_additive: 2,
      migration_non_additive: 3,
      default: 2,
    },
    tier2_requires_role: "lead",
  },
  verification: {
    profiles: {
      docs: { resource_class: "light", commands: ["node scripts/agentops/check-plan.mjs"] },
    },
  },
  resources: { classes: ["light", "moderate", "heavy"], exclusive: [] },
  database: {
    tool: "db_migrate",
    dev_project_ref: null,
    production_project_refs: [],
    env_file: "apps/web/.env.local",
    migrate_command: null,
    verify_command: null,
    lease_minutes: 30,
    resource_class: "light",
  },
  deployment: {
    provider: "vercel",
    allowed_branches: ["main", "develop"],
    production_branch: "main",
    excluded_branches: ["staging"],
    sensitive_paths: [
      "vercel.json",
      "apps/*/vercel.json",
      ".github/workflows/**",
      "package.json",
      "apps/*/package.json",
      "pnpm-lock.yaml",
      "apps/**",
      "packages/**",
    ],
  },
  worktree: {
    root: "../worktrees",
    branch_prefix: "feature",
    base: "origin/develop",
    auto_create: true,
    require_isolated_claim: true,
  },
  cleanup: { require_apply_flag: true },
  reports: { directory: null },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function mergePolicy(base, override) {
  if (!isPlainObject(override)) return structuredClone(base);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) result[key] = mergePolicy(result[key], value);
    else result[key] = value;
  }
  return result;
}

/* --------------------------------------------------------------- git reads */

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function refExists(repo, ref) {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export function resolvePlanSource(repo, source = "auto") {
  if (source === "worktree") return { kind: "worktree", ref: "worktree", label: `worktree (${repo})` };
  if (source && source !== "auto") {
    if (!refExists(repo, source)) throw new PlanError(`plan source ref does not exist: ${source}`);
    return { kind: "ref", ref: source, label: source };
  }
  for (const candidate of ["origin/develop", "develop"]) {
    if (refExists(repo, candidate)) return { kind: "ref", ref: candidate, label: candidate };
  }
  return { kind: "worktree", ref: "worktree", label: `worktree (${repo})` };
}

function listPlanFiles(repo, source) {
  if (source.kind === "worktree") {
    const root = path.join(repo, "plan");
    if (!fs.existsSync(root)) return [];
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(path.relative(repo, full).split(path.sep).join("/"));
      }
    };
    walk(root);
    return files.sort();
  }
  const out = git(repo, ["ls-tree", "-r", "--name-only", source.ref, "--", "plan"]);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
}

function readFile(repo, source, relPath) {
  if (source.kind === "worktree") return fs.readFileSync(path.join(repo, relPath), "utf8");
  return git(repo, ["show", `${source.ref}:${relPath}`]);
}

/* ------------------------------------------------------------------- plans */

export function loadPlan(repo, { source = "auto" } = {}) {
  const src = resolvePlanSource(repo, source);
  const files = listPlanFiles(repo, src);
  const errors = [];
  const warnings = [];

  let policy = structuredClone(DEFAULT_POLICY);
  const policyPath = "plan/policy.yaml";
  if (files.includes(policyPath)) {
    try {
      const parsed = parseYaml(readFile(repo, src, policyPath), { source: policyPath });
      policy = mergePolicy(DEFAULT_POLICY, parsed);
    } catch (error) {
      errors.push(`${policyPath}: ${error.message}`);
    }
  } else {
    warnings.push("plan/policy.yaml is missing; built-in defaults are used");
  }

  const projectPath = "plan/PROJECT.md";
  let project = null;
  if (files.includes(projectPath)) {
    project = readFile(repo, src, projectPath);
  } else {
    warnings.push("plan/PROJECT.md is missing");
  }

  const milestones = [];
  for (const file of files.filter((entry) => /^plan\/milestones\/.+\.md$/.test(entry))) {
    try {
      const { meta, body } = parseFrontmatter(readFile(repo, src, file), { source: file });
      milestones.push({ file, meta, body });
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }

  const tasks = [];
  for (const file of files.filter((entry) => /^plan\/tasks\/.+\.md$/.test(entry))) {
    try {
      const { meta, body } = parseFrontmatter(readFile(repo, src, file), { source: file });
      tasks.push({ file, meta, body });
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }

  const plan = { source: src, files, policy, project, milestones, tasks };
  const validation = validatePlan(plan);
  plan.errors = [...errors, ...validation.errors];
  plan.warnings = [...warnings, ...validation.warnings];
  return plan;
}

export function validatePolicy(policy) {
  const errors = [];
  const profiles = policy?.verification?.profiles ?? {};
  const classes = policy?.resources?.classes ?? [];
  if (!["light", "moderate", "heavy"].every((entry) => classes.includes(entry))) {
    errors.push("policy.resources.classes must include light, moderate and heavy");
  }
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== "object") {
      errors.push(`verification profile "${name}" must be a mapping`);
      continue;
    }
    if (!classes.includes(profile.resource_class)) {
      errors.push(`verification profile "${name}" uses unknown resource_class "${profile.resource_class}"`);
    }
    if (!Array.isArray(profile.commands) || profile.commands.length === 0) {
      errors.push(`verification profile "${name}" must define a non-empty command list`);
    }
  }
  const target = policy?.integration?.target_branch ?? "develop";
  if ((policy?.integration?.protected_branches ?? []).includes(target)) {
    errors.push(`integration target "${target}" is also listed as protected`);
  }
  const deployment = policy?.deployment ?? {};
  const allowed = deployment.allowed_branches ?? [];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    errors.push("policy.deployment.allowed_branches must be a non-empty list");
  } else {
    if (!allowed.includes("main") || !allowed.includes("develop")) {
      errors.push("policy.deployment.allowed_branches must include main and develop");
    }
    if (allowed.includes("staging")) errors.push("policy.deployment.allowed_branches must not include staging");
  }
  if (!deployment.production_branch) {
    errors.push("policy.deployment.production_branch must be set");
  } else if (!allowed.includes(deployment.production_branch)) {
    errors.push("policy.deployment.production_branch must be deployment-eligible");
  }
  if (!Array.isArray(deployment.excluded_branches) || !deployment.excluded_branches.includes("staging")) {
    errors.push("policy.deployment.excluded_branches must explicitly exclude staging");
  }
  if (!Array.isArray(deployment.sensitive_paths) || deployment.sensitive_paths.length === 0) {
    errors.push("policy.deployment.sensitive_paths must be a non-empty list");
  }
  const worktree = policy?.worktree ?? {};
  for (const key of ["root", "branch_prefix", "base"]) {
    if (typeof worktree[key] !== "string" || worktree[key].trim() === "") {
      errors.push(`policy.worktree.${key} must be a non-empty string`);
    }
  }
  for (const key of ["auto_create", "require_isolated_claim"]) {
    if (typeof worktree[key] !== "boolean") {
      errors.push(`policy.worktree.${key} must be true or false`);
    }
  }
  return errors;
}

export function deploymentContractIssues(contract, policy) {
  const warnings = [];
  const errors = [];
  const sensitive = policy?.deployment?.sensitive_paths ?? [];
  const touches = (contract?.ownership ?? []).some((glob) =>
    sensitive.some((sensitiveGlob) => globsMayOverlap(glob, sensitiveGlob)),
  );
  if (touches && !contract?.deployment_impact) {
    warnings.push("deployment_impact is required before this contract can be claimed (ownership touches deployment-sensitive paths)");
  }
  if (contract?.deployment_impact && !["none", "code", "config"].includes(contract.deployment_impact)) {
    errors.push("deployment_impact must be none, code or config");
  }
  if (contract?.deployment_impact && contract.deployment_impact !== "none") {
    if (typeof contract.deployment_verification !== "string" || contract.deployment_verification.trim() === "") {
      errors.push("deployment_verification is required when deployment_impact is code or config");
    }
  }
  return { touches, warnings, errors };
}

export function validateContract(contract, { policy, allIds, milestones = [] } = {}) {
  const errors = [];
  const id = contract?.id;
  if (!id || !/^T-[0-9]{4,}$/.test(String(id))) errors.push("id must match T-0000");
  for (const field of CONTRACT_REQUIRED) {
    if (!(field in (contract ?? {}))) errors.push(`missing required field: ${field}`);
  }
  for (const field of ["dependencies", "ownership", "out_of_scope", "interfaces", "deliverables", "acceptance", "constraints_security", "constraints_compatibility", "escalation"]) {
    if (field in contract && !Array.isArray(contract[field])) errors.push(`${field} must be a list`);
  }
  if (contract?.status && !CONTRACT_STATUSES.includes(contract.status)) {
    errors.push(`status must be one of ${CONTRACT_STATUSES.join(", ")}`);
  }
  if (contract?.rev !== undefined && (!Number.isInteger(contract.rev) || contract.rev < 1)) {
    errors.push("rev must be a positive integer");
  }
  if (contract?.database_migration && !MIGRATION_KINDS.includes(contract.database_migration)) {
    errors.push(`database_migration must be one of ${MIGRATION_KINDS.join(", ")}`);
  }
  for (const key of ["title", "milestone", "priority", "objective", "outcome", "verification_profile", "integration_target"]) {
    if (key in contract && (typeof contract[key] !== "string" || contract[key].trim() === "")) {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if ((contract?.ownership ?? []).length === 0) errors.push("ownership must list at least one path glob");
  if ((contract?.acceptance ?? []).length === 0) {
    errors.push("acceptance must list at least one checkable criterion");
  }
  for (const entry of contract?.acceptance ?? []) {
    if (typeof entry !== "string" || !/^[A-Z]+[0-9]+\s+\[(test|cmd|review)\]:\s+\S/.test(entry)) {
      errors.push(`acceptance entry must look like "AC1 [test]: ..." (got: ${String(entry).slice(0, 60)})`);
    }
  }
  const profile = contract?.verification_profile;
  if (profile && policy && !(policy.verification?.profiles ?? {})[profile]) {
    errors.push(`verification_profile "${profile}" is not defined in plan/policy.yaml`);
  }
  if (contract?.integration_target && policy && contract.integration_target !== policy.integration?.target_branch) {
    errors.push(
      `integration_target must be "${policy.integration?.target_branch}" (policy), not "${contract.integration_target}"`,
    );
  }
  if (allIds && id && contract?.dependencies?.includes(id)) errors.push("a task cannot depend on itself");
  for (const dep of contract?.dependencies ?? []) {
    if (allIds && !allIds.has(dep)) errors.push(`dependency ${dep} does not exist`);
  }
  if (milestones.length > 0 && contract?.milestone && !milestones.some((entry) => entry.meta?.id === contract.milestone)) {
    errors.push(`milestone "${contract.milestone}" has no file under plan/milestones/`);
  }
  errors.push(...deploymentContractIssues(contract, policy).errors);
  return errors;
}

export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  errors.push(...validatePolicy(plan.policy));

  const ids = new Set();
  for (const task of plan.tasks) {
    if (ids.has(task.meta?.id)) errors.push(`duplicate task id: ${task.meta?.id}`);
    if (task.meta?.id) ids.add(task.meta.id);
  }
  for (const task of plan.tasks) {
    const fileId = /^plan\/tasks\/(T-[0-9]{4,})/.exec(task.file)?.[1];
    if (fileId && task.meta?.id && fileId !== task.meta.id) {
      errors.push(`${task.file}: filename id ${fileId} does not match contract id ${task.meta.id}`);
    }
    for (const error of validateContract(task.meta, { policy: plan.policy, allIds: ids, milestones: plan.milestones })) {
      errors.push(`${task.file}: ${error}`);
    }
    for (const warning of deploymentContractIssues(task.meta, plan.policy).warnings) {
      warnings.push(`${task.file}: ${warning}`);
    }
  }

  // dependency cycles
  const graph = new Map(plan.tasks.map((task) => [task.meta?.id, task.meta?.dependencies ?? []]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, stack) => {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...stack, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) if (graph.has(dep)) visit(dep, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) if (id) visit(id, []);

  if (plan.tasks.length === 0) warnings.push("no task contracts found under plan/tasks/");
  if (plan.milestones.length === 0) warnings.push("no milestone files found under plan/milestones/");
  return { errors, warnings };
}

/* -------------------------------------------------------------- amendments */

export function parseAcceptance(entries) {
  const map = new Map();
  for (const entry of entries ?? []) {
    const match = /^([A-Z]+[0-9]+)\s+\[(test|cmd|review)\]:\s+([\s\S]+)$/.exec(String(entry));
    if (match) map.set(match[1], { id: match[1], check: match[2], text: match[3].trim() });
  }
  return map;
}

export function diffContracts(oldContract, newContract, tiers = DEFAULT_POLICY.amendments.tiers) {
  const changes = [];
  const add = (field, description) => changes.push({ field, description });

  if (oldContract.objective !== newContract.objective) add("objective", "objective changed");
  if (oldContract.title !== newContract.title) add("title", "title changed");
  if (oldContract.milestone !== newContract.milestone) add("milestone", "milestone changed");
  if (String(oldContract.priority) !== String(newContract.priority)) add("priority", "priority changed");
  if (oldContract.status !== newContract.status) add("status", "status changed");
  if (oldContract.verification_profile !== newContract.verification_profile) add("verification_profile", "verification profile changed");
  if (oldContract.database_migration !== newContract.database_migration) add("database_migration", "database migration class changed");
  if ((oldContract.deployment_impact ?? null) !== (newContract.deployment_impact ?? null)) {
    add("deployment_impact", "deployment impact declaration changed");
  }
  if ((oldContract.deployment_verification ?? null) !== (newContract.deployment_verification ?? null)) {
    add("deployment_verification", "deployment verification changed");
  }

  const oldAcs = parseAcceptance(oldContract.acceptance);
  const newAcs = parseAcceptance(newContract.acceptance);
  for (const [id, oldAcsEntry] of oldAcs) {
    const next = newAcs.get(id);
    if (!next) {
      add(`acceptance.${id}`, `acceptance criterion ${id} removed`);
      continue;
    }
    if (next.text !== oldAcsEntry.text) add(`acceptance.${id}`, `acceptance criterion ${id} text changed`);
    if (CHECK_RANK[next.check] < CHECK_RANK[oldAcsEntry.check]) {
      add(`acceptance.${id}.check`, `acceptance criterion ${id} check downgraded ${oldAcsEntry.check} -> ${next.check}`);
    }
  }
  for (const id of newAcs.keys()) if (!oldAcs.has(id)) add(`acceptance.${id}`, `acceptance criterion ${id} added`);

  const setDiff = (field) => {
    const before = new Set(oldContract[field] ?? []);
    const after = new Set(newContract[field] ?? []);
    return {
      added: [...after].filter((entry) => !before.has(entry)),
      removed: [...before].filter((entry) => !after.has(entry)),
    };
  };
  const ownership = setDiff("ownership");
  if (ownership.added.length) add("ownership", `ownership widened (+${ownership.added.length})`);
  if (ownership.removed.length) add("ownership.removed", `ownership narrowed (-${ownership.removed.length})`);

  const scopeOut = setDiff("out_of_scope");
  if (scopeOut.added.length) add("scope_narrowed", `out_of_scope added (+${scopeOut.added.length})`);
  if (scopeOut.removed.length) add("scope_out_removed", `out_of_scope removed (-${scopeOut.removed.length})`);

  const deps = setDiff("dependencies");
  if (deps.added.length) add("dependencies_added", `dependencies added (+${deps.added.length})`);
  if (deps.removed.length) add("dependencies_removed", `dependencies removed (-${deps.removed.length})`);

  const interfaces = setDiff("interfaces");
  if (interfaces.added.length || interfaces.removed.length) add("interface_changed", "interfaces changed");

  for (const field of ["deliverables", "constraints_security", "constraints_compatibility", "escalation"]) {
    const diff = setDiff(field);
    if (diff.added.length) add(field, `${field} entries added (+${diff.added.length})`);
    if (diff.removed.length) add(`${field}.removed`, `${field} entries removed (-${diff.removed.length})`);
  }

  const floorFor = (change) => {
    const field = change.field;
    const tiersMap = tiers ?? DEFAULT_POLICY.amendments.tiers;
    const rule = (name, fallback) => tiersMap[name] ?? fallback;

    if (field === "objective" || field === "milestone" || field === "scope_out_removed" || field === "dependencies_removed") {
      return 3;
    }
    if (field.startsWith("acceptance.")) {
      return change.description.includes("added")
        ? rule("acceptance_added", 1)
        : rule("acceptance_changed", 3);
    }
    if (field === "scope_narrowed") return rule("scope_narrowed", 1);
    if (field === "dependencies_added") return rule("dependencies_added", 1);
    if (field === "ownership") return rule("ownership_changed", 2);
    if (field === "ownership.removed") return rule("scope_narrowed", 1);
    if (field === "verification_profile") return rule("verification_changed", 2);
    if (field === "deployment_impact" || field === "deployment_verification") return 1;
    if (field === "interface_changed") return rule("interface_changed", 2);
    if (field === "database_migration") {
      if (newContract.database_migration === "non_additive") return rule("migration_non_additive", 3);
      if (newContract.database_migration === "additive") return rule("migration_additive", 2);
      return 1;
    }
    if (field.endsWith(".removed")) {
      if (field.startsWith("constraints_") || field.startsWith("escalation")) return 3;
      return 1;
    }
    if (field === "deliverables" || field.startsWith("deliverables")) return 1;
    if (field === "constraints_security" || field === "constraints_compatibility" || field === "escalation") return 1;
    if (field === "title" || field === "priority" || field === "status") return 1;
    return rule("default", 2);
  };

  for (const change of changes) {
    change.tier = floorFor(change);
  }

  const floor = changes.reduce((max, entry) => Math.max(max, entry.tier ?? 0), 0);
  return { changes, floor };
}

/* ------------------------------------------------------------- glob matching */

export function staticPrefix(glob) {
  const index = String(glob).search(/[*?]/);
  const prefix = index === -1 ? String(glob) : String(glob).slice(0, index);
  return prefix.replace(/\/+$/, "");
}

/** Conservative glob-vs-glob overlap: shared static prefix, or either side is fully wildcarded. */
export function globsMayOverlap(a, b) {
  if (a === b) return true;
  const prefixA = staticPrefix(a);
  const prefixB = staticPrefix(b);
  if (!prefixA || !prefixB) return true;
  return prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA);
}

export function globToRegExp(glob) {
  const normalized = String(glob).replaceAll("\\", "/");
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        i += 1;
        if (normalized[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  if (normalized.endsWith("/")) out += ".*";
  out += "$";
  return new RegExp(out);
}

export function matchesGlob(file, glob) {
  return globToRegExp(glob).test(String(file).replaceAll("\\", "/"));
}

export function matchesAny(file, globs) {
  return (globs ?? []).some((glob) => matchesGlob(file, glob));
}

/** Returns changed paths that fall outside the contract's ownership and plan authorization. */
export function scopeViolations(files, contract, { contractFile = null } = {}) {
  const allowed = contract.ownership ?? [];
  const forbidden = contract.out_of_scope ?? [];
  const violations = [];
  for (const file of files) {
    if (matchesAny(file, forbidden)) {
      violations.push({ file, reason: "matches out_of_scope" });
      continue;
    }
    if (file.startsWith("plan/")) {
      const authorized =
        matchesAny(file, allowed) ||
        file === contractFile ||
        file.startsWith("plan/amendments/") ||
        file.startsWith("plan/evidence/");
      if (!authorized) violations.push({ file, reason: "plan edit outside contract ownership" });
      continue;
    }
    if (!matchesAny(file, allowed)) violations.push({ file, reason: "not covered by ownership" });
  }
  return violations;
}
