# Architecture

AgentOps separates **intent**, **runtime state** and **evidence**. None of the three is allowed to
masquerade as another.

```text
                 +---------------------------+
                 |  Intent (Git, develop)    |
                 |  plan/PROJECT.md          |
                 |  policy.yaml, tasks,      |
                 |  milestones, amendments   |
                 +-------------+-------------+
                               | read via Git ref
                               v
+-------------------+   +-------------------+   +----------------------+
|  agentctl / CLI   |-->|  State (SQLite)   |-->|  Evidence (tool)     |
|  claim, verify,   |   |  .git/agentops/   |   |  tree SHA, runs,     |
|  submit, integrate|   |  state.db         |   |  logs, exit codes    |
+---------+---------+   +-------------------+   +----------+-----------+
          |                                              |
          v                                              v
+-------------------+                          +----------------------+
|  Worktrees        |                          |  GitHub Release /    |
|  one task/branch  |                          |  integration report  |
+-------------------+                          +----------------------+
```

## Intent plane

Versioned on `develop` under `plan/`:

- `PROJECT.md` — objectives, non-goals, global definition of done.
- `policy.yaml` — integration target, verification profiles, deployment allowlist, resources,
  database target, worktree settings, cleanup policy.
- `milestones/` — grouping.
- `tasks/` — contracts with YAML frontmatter and a human-readable body.
- `amendments/` — append-only contract changes.
- `evidence/` — tool-generated integration summaries.
- `knowledge/decisions/` — ADRs.

`agentctl` reads the plan through a Git ref (`origin/develop` by default), never from a possibly stale
checkout. `--plan-source worktree` exists only for bootstrapping and tests.

## State plane

`<git-common-dir>/agentops/state.db` is shared by all worktrees of one clone and never committed:

| Table | Purpose |
| --- | --- |
| `tasks` | Contract revision, runtime state, owner, worktree, branch, base/head, integration commit |
| `claims` | Leases, fencing tokens, history |
| `events`, `journal` | Durable execution history |
| `amendments` | Proposed/accepted contract changes and approvals |
| `acks` | Contract-revision acknowledgments |
| `evidence`, `runs` | Tool-produced verification and command measurements |
| `reservations` | Resource admission |
| `locks` | Integration and development-database leases |

Claims use `BEGIN IMMEDIATE`; every claim increments a fencing counter. Stale owners are rejected.
Leases expire into `stale` without deleting work. State is local to each clone — two machines do not
share claims.

## Evidence plane

`agentctl verify` runs the contract's profile through a resource reservation and records:

- commit and tree SHA,
- command, exit code, duration, resource level, log path,
- start/finish timestamps.

`submit` refuses if evidence does not match the current tree. `integrate` runs the profile on the
merged candidate, writes an evidence summary, and only then advances `develop`.

## Lifecycle

```text
draft -> ready -> claimed -> in_progress -> verified -> submitted -> integrated -> done
side states: stale, blocked, integration_failed, needs_rebase, cancelled, superseded
```

Transitions right of `in_progress` are produced by the tool that generated the evidence. Resource
deferrals are not failures: the task keeps its state, the deferral is journaled, and the agent moves on.

## Worktree isolation

`agentctl claim` auto-creates `<worktree.root>/<repo>-<task>` on
`<branch_prefix>/<task>-<slug>` from `origin/develop`. With `require_isolated_claim`, it refuses the
primary checkout, unregistered or dirty worktrees, branch mismatches and worktrees already claimed by
another task. See [Worktrees](/worktrees).

## Deterministic integrator

The integrator has no model logic. It:

1. re-reads the contract, revision, acknowledgments and dependencies;
2. verifies the source commit is on the remote;
3. refuses out-of-scope diffs and unexpected develop movement;
4. merges into a scratch worktree;
5. runs the contract profile and optional authorized development migration;
6. commits a tool-generated evidence summary;
7. advances `develop` with a compare-and-swap ref update, pushes, and verifies `origin/develop`;
8. marks the task integrated/done.

On failure, `develop` stays at its last verified commit and the source branch is preserved.

## Resources and subagents

Every command runs through an expiring reservation. Light work is always admitted; moderate/heavy work
is deferred under pressure with an explicit message. Subagents share the same budget; parallelize light
work only. A read-only `benchmark` subagent is the standard for measured claims.

## Security boundaries

- Production credentials, data and destructive operations are out of scope.
- Deployment allowlist: only `main` and `develop`; agents never promote `main`.
- No force-push, no history rewrite, no shared state on network drives.
- Verification evidence is tool-produced; prose is not evidence.
