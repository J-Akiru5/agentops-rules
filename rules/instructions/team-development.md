# Team development across machines

This file applies when more than one machine (or more than one agent team) works on the same
repository. It extends the other global rules; it does not replace them.

## Rules travel, state does not

- Global rules are installed from the same package on every machine. Keep the installed version
  identical and update deliberately.
- `<git-common-dir>/agentops/state.db` is **local to each clone**. Claims, leases, fencing tokens,
  journals and evidence are not shared across machines. Do not place this database on a network
  share, OneDrive, or any synced folder.
- Two machines can therefore claim the same task in their local state. Prevent duplicate work by
  assignment in the plan/PR and by branch ownership — not by assuming a local claim reserves work
  everywhere.

## Roles

- Designate one **integrator machine** (normally the owner's primary machine). Only it runs
  `agentctl integrate` and pushes `origin/develop`.
- Other machines implement, verify and push task branches. They do not run integration unless the
  owner explicitly changes the designated integrator.
- Only the human promotes `main`. No agent pushes `main` or `staging`.
- Use a unique `AGENT_ID` per machine (for example `opencode-loq`, `opencode-laptop2`) so local
  journals, evidence and acknowledgments are attributable.

## Task flow

1. Fetch `origin/develop`; run `agentctl plan sync` so the contract comes from the authoritative ref.
2. Work in an isolated worktree on a task branch owned by that task.
3. Run the contract's verification profile locally; commit and push the task branch.
4. Submit/integrate on the designated integrator machine (or use the repository's PR workflow).
5. The integrator verifies the candidate and pushes `develop`.
6. Other machines fetch/rebase on `origin/develop` before starting or submitting their next task.

## Shared constraints

- Never push `main` or `staging`; never force-push or rewrite shared history.
- Deployment allowlist: only `main` and `develop`. Before pushing a feature branch, confirm the
  repository's allowlist is active on `main`; otherwise Vercel may still create preview deployments
  and consume the daily allowance. Never deploy to test.
- Resource measurements are per machine. Run `orchestrator resources` locally and respect that
  host's limits; never assume the other machine's capacity.
- Cross-machine atomic claims require a shared state service, which this package does not provide.
  If two machines must make atomic claims, stop and design that service instead of pretending local
  SQLite coordinates across machines.
- Conflict handling: fetch and rebase on `origin/develop`; the integrator resolves supported
  conflicts and returns ambiguous ones for review.

## Handoff record

Every task must record the objective, branch/worktree, files owned, checks run, blockers, and next
steps in the plan, task or PR so the other machine can resume without guessing.
