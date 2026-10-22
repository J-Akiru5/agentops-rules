# Changelog

## 1.4.0 — 2026-10-22

- **Automatic worktree instantiation**: `agentctl claim` creates an isolated worktree and task branch
  by default from `worktree.root` / `branch_prefix` / `base` in `plan/policy.yaml`.
- **Isolation enforcement**: claims refuse the primary worktree, unregistered paths, dirty worktrees,
  branch mismatches, and worktrees already claimed by another task.
- **Flags/overrides**: `--create`, `--no-create`, and clean registered `--worktree`; auto-create
  defaults are on, with a policy switch for deliberate manual management.
- **Docs**: `docs/WORKTREES.md` covers policy, claim behavior, isolation, session move, cleanup and
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
- Installer copies `agents/`; docs updated (`docs/SUBAGENTS.md`, OPENCODE-2, TEAM-PLAN, README).
- Tests updated for deferral recording and integration deferral (no `develop` movement).

## 1.2.0 — 2026-10-21

- **OpenCode 2 documentation and migration**: `docs/OPENCODE-2.md` covers fresh install, V1 → V2
  upgrade, config verification and troubleshooting.
- Installer **migrates V1 `permission` to V2 `permissions`** (including `bash`/`shell` maps) and
  removes the deprecated block; V1 installs write both `permission.bash` and `permission.shell`.
- **Team plan**: `docs/TEAM-PLAN.md` — rollout phases, roles, pilot task, deployment prerequisite,
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

