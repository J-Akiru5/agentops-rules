# Changelog

## 1.7.0 — 2026-11-11

- **The repository decides which branches deploy.** A repository's `vercel.json`, its own
  `AGENTS.md` and `plan/policy.yaml` are the allowlist. `main` plus `develop` is only the default
  for a repository that declares nothing. Agents never edit a repository's allowlist to match the
  global rule. This removes a conflict with repositories that deploy `staging` instead of `develop`.
- **`plan validate` no longer hard-codes branch names.** It no longer requires `develop` in
  `deployment.allowed_branches` or `staging` in `excluded_branches`. It checks that the list is
  non-empty, that the production branch is in it, and that no branch is both allowed and excluded.
- **The AgentOps backbone is opt-in per repository.** `agentops-backbone.md` and
  `team-development.md` are still installed, but the installer no longer lists them in
  `instructions` and removes existing entries for them. The managed `AGENTS.md` block tells the
  agent to read them only where `plan/policy.yaml` exists. Sessions in other repositories load about
  11 KB less prose and are no longer told to run `agentctl` steps that do not apply.
- **Contradictions removed.** Integration follows the workflow the repository documents (pull
  request, integrator or orchestrator) instead of prescribing one; the "no parallel coordination
  database" line now names the backbone's state database as the one exception; the deployment rule is
  stated once in `deployment-governance.md` and the other files point to it.
- **A local check is not the gate.** The autonomy rule now says CI on the pushed commit and the
  repository's named merger are the gate, and that a check that did not run is never reported as
  passed.
- **Release check is conditional.** The global rule no longer assumes every repository has
  `scripts/release-check.mjs`.
- **Repository rules win on "ask the owner".** A repository's own list of owner-only actions
  (migrations, schema, auth, RLS) overrides the global Tier B default.
- No change to the 27 permission rules, the CLI or the state schema.

## 1.6.0 — 2026-10-22

- **Development-first authorization**: development database migrations against the verified
  development target and `develop` deployments are pre-authorized. Agents apply them without asking;
  production credentials/data and production migrations remain out of scope.
- **Explicit main deployment**: `main` stays owner-reviewed by default. An explicit owner instruction
  to deploy/promote `main` authorizes that specific deployment, including the owner-authorized admin
  path when GitHub branch protection or repository policy blocks it. No force-push, history rewrite,
  permanent protection change or production migration.
- **Permission effects**: the V2 installer now updates managed permission effects in place instead of
  adding duplicates. The Vercel deploy/promote/redeploy entries and admin-merge move from `ask` to
  `allow`; rollback, deploy hooks, database reset and force-push remain `ask`. Still 27 rules.
- **Rules/docs**: deployment governance, autonomy tiers, AgentOps database/deployment sections, team
  roles, architecture, security, team plan and docs site updated. No CLI/state/schema change.

## 1.5.0 — 2026-10-22

- **Versioning and release governance**: new `versioning.md` instruction (sixth managed file), global
  AGENTS section, SemVer mapping, version-source checks, human-published releases and immutable tags.
- **Public documentation site**: VitePress site with guide/reference pages, local search and GitHub Pages
  deployment; README overhauled for public consumption.
- **Repository infrastructure**: MIT license, SECURITY, CONTRIBUTING, issue/PR templates, CODEOWNERS,
  CI matrix (Windows/Ubuntu, Node 22/24), tag-driven release workflow with zip + SHA256, docs workflow.
- **Release gate**: `scripts/release-check.mjs` validates `package.json`/`VERSION`/tag/changelog/docs;
  `scripts/release-notes.mjs` extracts notes from the changelog.
- **6 instructions / 27 permissions** expected after reinstall; no breaking installer or state change.
- **Fixed** Windows 8.3 short-path canonicalization in worktree isolation checks (CI parity).

## 1.4.0 — 2026-10-22

- **Automatic worktree instantiation**: `agentctl claim` creates an isolated worktree and task branch
  by default from `worktree.root` / `branch_prefix` / `base` in `plan/policy.yaml`.
- **Isolation enforcement**: claims refuse the primary worktree, unregistered paths, dirty worktrees,
  branch mismatches, and worktrees already claimed by another task.
- **Flags/overrides**: `--create`, `--no-create`, and clean registered `--worktree`; auto-create
  defaults are on, with a policy switch for deliberate manual management.
- **Docs**: `docs/worktrees.md` covers policy, claim behavior, isolation, session move, cleanup and
  big-feature decomposition. Global rules, team plan and README updated.
- **Tests**: auto-create path/branch/registration, primary/unregistered/dirty/already-claimed refusal,
  and existing cleanup behavior.

## 1.3.0 — 2026-10-22

- **Resource pressure is a deferral, not a stop order.** Red/amber levels continue with light work,
  light subagents, or another eligible task; heavy checks are deferred and retried. Updated
  `autonomous-orchestration`, `agentops-backbone`, the global `AGENTS.md` block and `orchestrator`
  advice.
- **Subagent orchestration standard**: `rules/instructions/subagent-orchestration.md` defines when to
  dispatch, the dispatch contract, resource rules and the benchmark standard.
- **Global `benchmark` subagent**: `rules/agents/benchmark.md` is read-only, cannot push/deploy/install,
  and returns measured evidence with baseline, workload, repetitions and spread.
- **AgentOps deferral semantics**: `verify` and `integrate` record a resource deferral, leave the task
  state intact, never mark failure, and instruct the agent to continue with other work.
- Installer copies `agents/`; docs updated (`docs/subagents.md`, OPENCODE-2, TEAM-PLAN, README).
- Tests updated for deferral recording and integration deferral (no `develop` movement).

## 1.2.0 — 2026-10-21

- **OpenCode 2 documentation and migration**: `docs/opencode-2.md` covers fresh install, V1 → V2
  upgrade, config verification and troubleshooting.
- Installer **migrates V1 `permission` to V2 `permissions`** (including `bash`/`shell` maps) and
  removes the deprecated block; V1 installs write both `permission.bash` and `permission.shell`.
- **Team plan**: `docs/team-plan.md` — rollout phases, roles, pilot task, deployment prerequisite,
  acceptance checklist and risks.
- `PROMPT.md` updated for v1.2.0 and OpenCode 2, with a config sanity command.
- Installer tests cover V1, V2, V1→V2 migration, idempotency, dry-run and refusal (7 tests).

## 1.1.0 — 2026-10-21

- **OpenCode V1 + V2 support**: installer detects `opencode --version` (override with
  `--opencode v1|v2`).
- V1 writes `permission.shell` rules and removes the V2 `permissions` array that made V1 report
  “Configuration is invalid … V2 permissions are not supported by OpenCode V1”.
- Instruction entries use absolute paths so both versions resolve them deterministically; legacy
  `~/.config/...` managed entries are migrated.
- Downloadable release (`agentops-rules.zip`) and `PROMPT.md` with a copy-paste install prompt.
- Installer tests cover V1, V2, migration, idempotency and dry-run (7 tests).

## 1.0.0 — 2026-10-21

- Initial portable global rules package.
- Includes waiting/status protocol, branch-aware worktree orchestration, autonomous engineering
  protocol, AgentOps planning backbone, Vercel deployment governance and multi-machine team rules.
- Includes `agentctl` and `orchestrator` helpers with tests.
- Non-destructive installer with backups, managed `AGENTS.md` block, config merge, dry-run and
  idempotent re-runs.

