# CLI reference

`agentctl` is the operational interface. Run `agentctl help` for the built-in list. Add `--json` for
machine-readable output. State lives in `<git-common-dir>/agentops/state.db`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Usage error |
| `3` | Refused, blocked, or **resource-deferred** (read the message; a deferral is not a task failure) |
| `4` | Unexpected anomaly |

## Plan

```text
agentctl plan sync [--source <ref|worktree>] [--offline]
agentctl plan validate [--source ...]
agentctl plan show [--file <path>] [--source ...]
```

`sync` fetches `origin` and refreshes contracts into state. `validate` checks required fields,
acceptance syntax, profiles, dependencies, cycles and deployment metadata. The default source is
`origin/develop`.

## Tasks

```text
agentctl task list
agentctl task show <T-0000> [--agent <id>]
```

Shows the contract, runtime state, ownership, dependencies, evidence freshness, deployment metadata and
blocked/deferred reason.

## Claim and leases

```text
agentctl claim <T-0000> --agent <id>
  [--worktree <path>] [--branch <name>]
  [--create | --no-create] [--lease-seconds <n>]
agentctl renew <T-0000> --agent <id>
agentctl release <T-0000> --agent <id> [--reason <text>]
agentctl ack <T-0000> --agent <id> [--rev <n>]
agentctl lease reap
```

With `worktree.auto_create` enabled (default), `claim` creates an isolated worktree and branch from
`worktree.base`, records the claim, acknowledges the contract revision and prints the path. With
`require_isolated_claim`, an explicit `--worktree` must be registered, non-primary, clean, on the
claimed branch and not claimed by another task. `--create` forces creation; `--no-create` disables it.

Only `ready` tasks whose dependencies are integrated can be claimed. Ownership globs and deployment
metadata are enforced before the claim.

## Journal and checkpoint

```text
agentctl journal <T-0000> --agent <id> -m "<note>"
agentctl checkpoint <T-0000> --agent <id> [-m "<note>"] [--push]
```

`checkpoint` records HEAD/tree, renews the lease, refuses an unacknowledged contract revision, and
optionally pushes the task branch.

## Verification and submission

```text
agentctl verify <T-0000> --agent <id> [--profile <name>]
agentctl submit <T-0000> --agent <id>
```

`verify` runs the contract profile under resource admission and records evidence for the current tree.
A resource refusal is a deferral: no task failure, no evidence pass. `submit` requires a clean tree,
current passing evidence, an in-scope diff and a pushed branch.

## Amendments

```text
agentctl amend <T-0000> --agent <id> --contract <file> --title <t> --evidence <e>
  [--tier <n>] [--approve <lead>] [--human-ref <ref>]
agentctl amend approve <A-0000> --agent <lead> [--human-ref <ref>]
```

The tier floor is computed from a structural contract diff. Tier 2 needs a registered lead distinct from
the proposer; Tier 3 needs explicit human authorization. Unapproved proposals are stored and do not
block unrelated tasks.

## Integration

```text
agentctl integrate <T-0000> --agent <integrator> [--plan-source <ref|worktree>]
```

The deterministic integrator merges a candidate, verifies it, records evidence, advances `develop` by
compare-and-swap, pushes and verifies the remote. A resource deferral leaves `develop` unchanged and the
task `submitted`.

## Database

```text
agentctl db status
agentctl db push --agent <id> [--task <T-0000>]
```

`status` verifies the configured development target from `SUPABASE_DB_URL` (host and username) without
printing it. `push` holds the exclusive `db-dev` lease, runs the configured migration command, records
evidence and never targets production refs. Development migrations are pre-authorized: run them
without asking when the target is verified. Production migrations remain out of scope even when the
owner authorizes a `main` deployment.

## Machine and reporting

```text
agentctl resources
agentctl inventory
agentctl status
agentctl report [--out <file>] [--save]
agentctl cleanup [--apply]
agentctl agent register --id <id> --role <implementer|lead|reviewer|integrator>
agentctl agent list
agentctl init
```

`cleanup` is a dry run; `--apply` removes only clean, unclaimed, terminal, remote-preserved worktrees.
`report` is generated from state and Git. `inventory` combines Git worktree facts with claims.
