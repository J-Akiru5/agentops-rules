# Agent Waiting and Status Protocol

Applies to autonomous orchestration, parallel agents, background jobs, long-running tests, builds, deployments, and any external dependency.

## When waiting, blocked, or running

State a status block. Never report vague progress or imply activity that is not real.

- **Status:** Waiting, blocked, or running — pick exactly one.
- **Waiting on:** The exact test, agent, approval, CI job, background process, external dependency, or other condition.
- **Progress:** Completed work versus total work, when measurable (e.g., `13/22 suites passed`).
- **Next action:** What happens when the dependency resolves.
- **User action:** The exact decision or action required from the user, or `No action needed from you.`

Example:

> **Status:** Waiting on the 22-suite E2E batch.
>
> **Progress:** 13/22 suites passed; 9 remaining.
>
> **Next action:** Collect the final results, investigate failures, and rerun affected checks.
>
> **User action:** No action needed from you. I will continue when the batch finishes.

## Autonomous orchestration

- Continue independent, safe, useful work while a dependency is pending.
- Do not claim work is running when no process, job, or agent is actually active.
- Do not promise automatic resumption unless the execution environment genuinely supports it. If execution cannot continue without an external event, explicitly identify that limitation.
- Ask the user only for decisions, permissions, or access that genuinely require their intervention. When the user must act, state exactly what is needed and why.

## Progress updates

- Provide concise updates at meaningful milestones, not on every minor operation.
- When blocked, give a durable status report rather than vague statements such as "working on it".
- If a task is complete, report the outcome and verification evidence instead of presenting it as pending.
- If the user asks for a status update, distinguish verified facts from estimates.
- Never claim a test, deployment, or background operation succeeded without evidence.

## Completion and handoff

Every final handoff must clearly distinguish:

1. Completed and verified.
2. Still running.
3. Waiting or blocked.
4. Requires user action.
5. Next planned action.

# Branch-Aware Worktree Orchestration

## 1. Mission

OpenCode agents must maintain awareness of the local Git worktree ecosystem and coordinate the safe reconciliation of parallel development work into `develop`.

Treat all local worktrees as parts of a potentially interconnected development effort, not as isolated repositories.

The objective is to:
- Discover existing worktrees and branches.
- Understand what each worktree is doing.
- Detect overlapping changes, dependencies, and merge risks.
- Plan and execute safe reconciliation into `develop`.
- Verify the integrated result.
- Preserve recoverable remote copies of completed work.
- Purge only worktrees that have been verified as safe to remove.

**Never sacrifice existing work to achieve a clean branch or working directory.**

## Worktree instantiation and isolation

`agentctl claim <T-0000> --agent <id>` creates the task worktree and branch by default using the
policy `worktree` settings (`root`, `branch_prefix`, `base`, `auto_create`, `require_isolated_claim`).
It refuses the primary worktree, unregistered or dirty worktrees, a branch mismatch, and worktrees
already claimed by another task. After creation, move the session to the new worktree with the host's
worktree/session tool or use that path explicitly; never implement in the primary checkout. If
auto-create is disabled, pass `--create` or a clean isolated `--worktree`. Split a large feature into
task contracts rather than keeping one long-lived mega-worktree.

## 2. Worktree Discovery Is Mandatory

Before performing cross-branch reconciliation, cleanup, or other operations that may affect multiple worktrees, inspect the actual local Git environment.

Use Git's authoritative worktree information, including `git worktree list --porcelain`, and inspect relevant repositories and branches.

Build a worktree inventory containing:

- Repository identity and root path.
- Worktree path.
- Checked-out branch, detached HEAD, or other state.
- Current commit and relationship to the relevant base branch.
- Tracked modifications, staged changes, and untracked files.
- Unpushed commits and upstream tracking status.
- Whether the worktree is active, locked, or otherwise protected.
- Related task, agent, pull request, or feature context when discoverable.
- Potential dependencies or overlapping files with other worktrees.

Do not assume all worktrees are in the current repository, share the same remote, or target the same base branch.

Distinguish verified facts from inferred ownership or task purpose. Do not interrupt another agent or process merely to gather information.

If repository identity, branch ownership, or worktree state cannot be determined safely, flag the uncertainty before taking consequential action.

## 3. Build a Reconciliation Plan Before Merging

Before modifying shared branches, create a reconciliation plan.

For each candidate worktree, determine:

1. What changes it contains.
2. Whether its changes are committed, uncommitted, or partially implemented.
3. Whether another branch already contains the same work.
4. Whether it depends on changes from another worktree.
5. Whether it conflicts with, duplicates, or supersedes other work.
6. Whether it is ready for integration or requires additional work.
7. How the integrated result will be tested.

Classify each worktree as one of:

- **Ready:** Suitable for reconciliation.
- **Blocked:** Depends on unfinished work, missing approvals, or unavailable information.
- **Conflicting:** Requires an explicit conflict-resolution decision.
- **Uncommitted:** Contains changes that must be preserved and assessed.
- **Already integrated:** Its relevant changes are already present in the target branch.
- **Abandoned candidate:** Appears obsolete but requires ownership and preservation checks before disposal.
- **Protected/unknown:** Must not be modified or deleted until its status is understood.

Do not infer that a branch is obsolete merely because it is old, has no upstream, or appears merged.

## 4. Reconcile Into `develop` Safely

The default integration target is `develop`, unless the repository's documented workflow explicitly specifies otherwise.

For every integration:

- Confirm the repository, source branch, target branch, and current commit.
- Fetch remote state when appropriate and inspect divergence before proceeding.
- Preserve uncommitted work and avoid modifying a worktree owned by another active task without coordination.
- Prefer the repository's established merge or pull-request workflow.
- Integrate changes in dependency-aware order.
- Avoid blind bulk merges, indiscriminate rebases, and forced updates to shared branches.
- Never use destructive resets, forced pushes, or history rewriting on shared branches without explicit authorization.
- Do not bypass required review, CI, or repository protections.

If the repository requires pull requests, reconcile through that workflow rather than bypassing it for convenience.

### Conflict handling

When conflicts occur:

1. Identify the conflicting files and the competing changes.
2. Explain the semantic conflict, not merely the Git markers.
3. Determine the intended behavior from code, tests, task requirements, and documented decisions.
4. Resolve automatically only when the correct outcome is sufficiently supported by evidence.
5. Preserve compatible contributions from both branches whenever possible.
6. Flag ambiguous, architectural, security-sensitive, or behavior-changing conflicts for human review.
7. Never silently discard changes to make a merge succeed.

After resolution, inspect the complete diff and test the merged state. A conflict-free Git merge is not proof of a correct integration.

## 5. Verify the Integrated State

After reconciliation, verify the actual target branch, not merely the individual source branches.

At minimum:

- Confirm the intended commits and changes are present in `develop`.
- Inspect the final diff for accidental deletions, duplicate implementations, or unrelated modifications.
- Run the relevant automated tests, linting, type checks, builds, and CI gates supported by the repository.
- Validate interactions between integrated components.
- Confirm no known unresolved merge markers or conflicts remain.
- Record checks that could not be executed and explain why.
- Confirm the target branch's resulting commit and repository state.

Do not claim success based only on a successful merge command.

If verification fails, stop further cleanup, report the failure, and preserve the source worktrees needed for diagnosis or recovery.

## 6. Remote Preservation Is a Prerequisite for Purging

A local branch or worktree must never be deleted merely because its changes appear integrated.

Before considering a worktree for removal, verify all of the following:

1. Its valuable changes are committed or otherwise safely preserved.
2. Those changes are present in the intended integration target, or a separate recoverable branch or reference preserves work that was not integrated.
3. A remote copy of the relevant branch or commit exists and has been verified to be reachable from the intended remote.
4. Any uncommitted or untracked work has been explicitly preserved or confirmed disposable by its owner.
5. Required tests and integration checks have passed, or any exceptions have been explicitly documented and accepted.
6. No active agent, process, lock, or task still depends on the worktree.
7. The worktree is not protected by a repository-specific retention rule.
8. The exact deletion target has been identified and reviewed.

A remote-tracking reference alone is not proof that the latest local commits have been uploaded. Verify remote reachability for the relevant commit.

If the source branch contains valuable changes that are not in `develop`, preserve them on a recoverable remote branch before considering worktree removal. Do not force-push over existing remote history.

If any prerequisite is uncertain, **do not purge**.

## 7. Purge Only Verified-Disposable Worktrees

After reconciliation and preservation are verified, OpenCode may clean up genuinely unused worktrees when authorized by the applicable global policy and tool permissions.

Before removal:

- Recheck the worktree inventory because its state may have changed.
- Confirm the worktree is not in use by another agent or process.
- Confirm the branch and commit are recoverable remotely.
- Confirm there are no uncommitted changes or untracked files requiring preservation.
- Identify the exact worktree path and associated branch.
- Record why removal is safe.

Use Git-aware worktree removal procedures rather than manually deleting directories.

Never remove a worktree that is dirty, locked, active, protected, or of uncertain ownership without explicit resolution. Do not force removal to bypass these safeguards.

After removal, verify that:
- The intended worktree is no longer registered.
- Its preserved branch or commit remains recoverable.
- Other worktrees and branches remain intact.
- `develop` remains at the expected verified commit.

If the user has not authorized automatic deletion, prepare a cleanup proposal and request approval rather than deleting the worktree.

## 8. Operational Modes

### Observe mode
Inventory worktrees, inspect branch relationships, identify risks, and report findings. Do not modify branches or remove worktrees.

### Reconciliation mode
Prepare the plan, integrate approved changes using the established workflow, resolve supported conflicts, and verify the resulting target branch. Preserve source work until verification is complete.

### Cleanup mode
Recheck integration, remote preservation, ownership, and worktree status. Remove only verified-disposable worktrees within the granted authorization.

When the requested mode is unclear, begin with Observe mode.

## 9. Reporting Requirements

For each reconciliation cycle, report:

- Repository identity and target branch.
- Worktrees discovered and their status.
- Branches ready, blocked, conflicting, already integrated, or protected.
- The planned integration order and rationale.
- Conflicts encountered, their resolution, and any human decisions required.
- Commits integrated and the final `develop` commit.
- Tests and verification results.
- Remote-preservation evidence.
- Worktrees removed and the evidence supporting each removal.
- Worktrees intentionally retained and why.
- Remaining risks and next actions.

Never claim a branch was integrated, a remote copy was verified, a test passed, or a worktree was purged unless the corresponding operation and verification actually occurred.

## 10. Governing Principle

**Discover first. Plan second. Reconcile deliberately. Verify the integrated state. Preserve remotely. Purge last.**

The purpose of orchestration is to consolidate parallel work without losing valuable changes, not to maximize merge speed or minimize the number of worktrees at any cost.

# Resource pressure, delegation and subagents

A red resource level is a scheduling constraint, **not a stop order**.

- Continue with light work, dispatch light subagents, or pick another eligible task while heavy
  builds/tests/installs are deferred. Do not idle while safe work exists.
- Never claim a deferred check passed. Record the deferral and retry when resources allow.
- Use subagents for independent, parallelizable work (exploration, review, docs, benchmarking); the
  parent verifies their output. Never use them to bypass permissions or deployments.
- The global `benchmark` subagent is the standard for performance/resource-sensitive work. It is
  read-only, cannot push or deploy, and reports measured evidence; the implementer may not
  self-certify its own benchmark.
- Full standard: `~/.config/opencode/instructions/subagent-orchestration.md`.

# Vercel Deployment Governance

Automatic Vercel deployments are allowed **only** for `main` and `develop`. Every other branch —
`staging`, feature, agent, temporary, experiment, Dependabot, unknown — and pull requests from them
are deployment-ineligible by default.

- Do not run `vercel deploy`, `vercel --prod`, `vercel promote`, `vercel redeploy`, `vercel rollback`,
  or create deploy hooks/webhook/API deployments without explicit authorization.
- Do not trigger a deployment to test the policy. Validate configuration statically.
- `vercel build` is a local build and is allowed; routine local builds/checks are unaffected.
- Deployment eligibility is not push permission: `develop` is pushed only by the integrator and
  `main` promotion is human-only.
- The integrator push to `develop` is the one eligible automatic deployment; never add a second one.
- Full protocol and the first-instantiation checklist:
  `~/.config/opencode/instructions/deployment-governance.md`.
