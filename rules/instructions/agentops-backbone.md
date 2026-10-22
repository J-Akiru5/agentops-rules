# AgentOps backbone — operational contract

This file extends `AGENTS.md` and `autonomous-orchestration.md`; it does not replace them. Precedence:
enforced `permissions` > authorization boundaries in `autonomous-orchestration.md` > `AGENTS.md` >
this file. Follow the stricter, more specific rule; if two rules genuinely conflict, stop and record it.

## The system

- **Intent**: `plan/PROJECT.md`, `plan/policy.yaml`, `plan/milestones/`, `plan/tasks/`,
  `plan/amendments/` on `develop`. Read it with `agentctl plan ...` (defaults to `origin/develop`),
  never from a possibly stale checkout. `--plan-source worktree` is only for bootstrapping a plan
  that is not on `develop` yet and for tests.
- **State**: `<git-common-dir>/agentops/state.db` — claims, leases, fencing tokens, amendments,
  evidence, locks. Never hand-edit it; use `agentctl`. State is local to each clone; cross-machine
  coordination follows `team-development.md`.
- **Evidence**: tool-produced rows keyed by tree SHA plus logs under
  `<git-common-dir>/agentops/logs/`. Agent prose is not evidence.
- **CLI**: `agentctl` (`~/.config/opencode/bin/agentctl.mjs`). Run `agentctl help`.

## Per-task workflow

1. `agentctl plan sync` — fetch origin and refresh contracts into state.
2. `agentctl task show <T-0000>` — read objective, acceptance criteria, ownership, dependencies.
3. `agentctl claim <T-0000> --agent <id>` — auto-creates an isolated worktree and branch from the
   policy base (`worktree.auto_create`), then atomically claims it. Pass `--worktree <path>` to use an
   existing clean, registered task worktree, or `--create` / `--no-create` to override policy. Only
   `ready` tasks whose dependencies are integrated can be claimed.
4. Work only in the worktree printed by the claim. Never edit another agent's worktree or mutate
   `develop` directly. Move the session to the printed path (host worktree/session tool) or use
   absolute paths.
5. `agentctl journal <T> -m "..."` and `agentctl checkpoint <T> --push` at milestones. Checkpoints
   renew the lease and refuse when the contract revision is not acknowledged.
6. `agentctl verify <T> [--profile]` — runs the contract profile under a resource reservation and
   writes evidence for the current tree.
7. `agentctl checkpoint <T> --push`, then `agentctl submit <T>` — requires a clean tree, current
   passing evidence, an in-scope diff and a pushed branch.
8. `agentctl integrate <T> --agent <integrator>` — the deterministic integrator merges into a scratch
   candidate, verifies, commits an evidence summary, advances `develop` by compare-and-swap, pushes,
   and verifies `origin/develop`. Only then is the task integrated/done.

## Definition of done

Implementation finished or a local build passing is not completion. Completion requires: passing
evidence for the integrated tree, scope compliance, an acknowledged contract revision, the source
branch preserved on the remote, successful integration into `develop`, and verified
`origin/develop`. On integration failure the task becomes `integration_failed` and `develop` stays
at its last verified commit.

## Amendments

- Never silently change objectives or weaken acceptance criteria.
- `agentctl amend <T> --agent <id> --contract <proposed-file> --title <t> --evidence <e>`.
- The tier floor is computed: added acceptance/tests = 1; ownership, interface, verification profile
  or additive migration changes = 2; objective changes, removed/changed acceptance, downgraded check
  types, removed constraints or non-additive migrations = 3.
- Tier 2 needs a registered lead agent different from the proposer. Tier 3 needs explicit human
  authorization (`--human-ref`). Unapproved proposals are recorded; park the task, continue unrelated
  work, never bypass the gate.

## Database

- Development migrations are authorized and autonomous: `agentctl db status` verifies the target,
  `agentctl db push --agent <id>` takes the exclusive `db-dev` lease, runs the configured migration
  command, records evidence and never prints the connection string.
- Never use production credentials or data. Never infer the target from a project nickname. If the
  target cannot be verified, stop the database operation and report the exact uncertainty.

## Resources

- Measure first: `agentctl resources`. Light work is always admitted. Moderate/heavy work is refused
  under pressure, but that refusal is a **deferral, not a task failure**: the task keeps its state, the
  deferral is journaled, and the agent continues with light work or another eligible task and retries
  later. Never mark a deferred check passed.
- If `verify` or `integrate` reports a resource deferral, do not release the claim or mark the task
  failed. Record the deferral and continue. The integrator leaves the task `submitted` and `develop`
  unchanged.
- Do not kill another agent's process to free resources without ownership.
- Delegation standard: `subagent-orchestration.md`. The parent verifies subagent output; the
  `benchmark` subagent is required for performance/resource-sensitive claims.

## Coordination and cleanup

- One task, one worktree, one branch. Claim before editing; `ownership` globs are exclusive.
- Use `agentctl inventory` / `agentctl status` before cross-worktree work. Foreign worktrees with
  uncommitted or unpushed work are never reset, cleaned or removed.
- `agentctl cleanup` is a dry run. `--apply` removes only worktrees that are unclaimed, clean,
  terminal, and preserved on the remote. Never force-remove.

## Honesty

Report verified facts separately from estimates. Never claim a test, migration, integration,
remote copy or cleanup that the tooling did not record. When blocked, state the exact dependency and
the next executable step.

## Deployment side effects

Deployment eligibility and prohibitions are defined in `instructions/deployment-governance.md`:
automatic Vercel deployments are allowed only for `main` and `develop`. In this protocol:

- Contracts that can affect deployment must declare `deployment_impact` (`none`/`code`/`config`) and,
  when not `none`, `deployment_verification`. Sensitive paths live in `plan/policy.yaml` and are
  enforced by `agentctl plan validate` and the integrator.
- The integrator's push to `develop` is the only automatic deployment trigger. Never follow an
  integration with a manual deploy, and never add a second deployment pathway for the same change.
- Deployment configuration is validated statically (config inspection + repo checks), never by
  deploying. A deployment is a side effect of an eligible push, not evidence that a task passed.
