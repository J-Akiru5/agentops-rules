# Worktrees: automatic instantiation, isolation, cleanup

Applies to `agentops-rules` v1.4.0+. The full branch-aware rules live in
[`../rules/AGENTS.md`](../rules/AGENTS.md).

## Policy

`plan/policy.yaml`:

```yaml
worktree:
  root: ../worktrees          # relative to the repo, or an absolute path
  branch_prefix: feature
  base: origin/develop
  auto_create: true
  require_isolated_claim: true
```

Defaults (when the block is absent) are the values above. Set `auto_create: false` only if you
deliberately manage worktrees yourself; claims will then require `--worktree` when
`require_isolated_claim` is true.

## Claim behavior

```powershell
agentctl claim T-0004 --agent opencode-loqu
```

With auto-create enabled, `claim`:

1. resolves `<worktree.root>/<repo>-<task>`;
2. creates `<branch_prefix>/<task>-<slug>` from `origin/develop`;
3. creates the worktree with `git worktree add`;
4. claims the task and prints the path.

It refuses if:

- the path already exists, or the branch already exists;
- the base ref is missing (run `agentctl plan sync`);
- the generated branch is protected or the integration target;
- the task is not ready, is already claimed, has unmet dependencies, or overlaps another claim.

Use an existing isolated worktree:

```powershell
agentctl claim T-0004 --agent opencode-loqu --worktree S:\Dev\Monorepo\worktrees\my-task
```

With `require_isolated_claim: true`, that worktree must be:

- registered with this repository (not an arbitrary directory);
- not the primary checkout;
- clean (no staged, unstaged, or untracked work);
- checked out on the claimed branch (or omit `--branch` and use its current branch);
- not already claimed by another task.

Override policy for one claim: `--create` forces creation; `--no-create` disables it (and refuses if
isolation is required).

## Move the session

`agentctl` cannot move an OpenCode session. After a claim creates a worktree, use the host's worktree
or session-move tool, or work with absolute paths. Do not edit files in the primary checkout after the
claim.

## Cleanup

`agentctl cleanup` remains a dry run by default. It removes a worktree only when it is:

- not the primary, not locked/prunable, and clean;
- not covered by an active claim;
- on a non-protected branch associated with a task in `integrated`/`done`/`cancelled`/`superseded`;
- with its head commit preserved on the remote.

`--apply` uses Git-aware removal and deletes the branch only when merged. It never force-removes.
Auto-created worktrees become cleanup candidates after integration and a pushed branch.

## Big features

A large feature is a **set of task contracts**, not one long-lived worktree:

- one contract per independently verifiable change;
- one worktree per contract (auto-created by `claim`);
- integrate each task into `develop` as it completes;
- keep an umbrella milestone/PR for the narrative, not a mega-branch;
- clean up each worktree after its task is integrated and preserved on the remote.

This keeps ownership, review, evidence, and cleanup tractable.

## Multi-machine note

Worktrees and runtime state are local to each clone. Do not share a worktree path or
`.git/agentops/state.db` between machines. Each machine creates its own worktrees from
`origin/develop`; the integrator reconciles branches through Git.
