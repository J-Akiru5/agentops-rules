# Team development plan — OpenCode 2 + AgentOps

Status: ready to execute
Owner: project owner (human)
Integrator machine: primary machine
Second machine: another laptop (OpenCode 2)
Project repository: `<project-repo>` (private)
Rules package: `J-Akiru5/agentops-rules` (public, v1.6.0+)

## Objective

Operate a two-machine team with identical OpenCode 2 rules, isolated worktrees, validated task
contracts, evidence-based verification and a single deterministic integrator. Avoid duplicate claims,
lost work and unnecessary Vercel deployments.

## Roles

| Role | Machine | Responsibilities |
| --- | --- | --- |
| Owner | any | Reviews `main`, explicitly authorizes main deployments, approves Tier-3 amendments, controls deployment quota decisions and publishes releases. |
| Integrator | primary | Runs `agentctl integrate`, pushes `origin/develop`, owns the final verified state. |
| Implementer | second | Claims assigned tasks, works in its auto-created worktree, verifies locally, pushes the task branch. |
| Lead (optional) | either | Approves Tier-2 amendments; must differ from the proposer. |

Runtime state (`.git/agentops/state.db`) is **local to each clone**. The two machines do not share
claims. Task assignment in the plan/PR and branch ownership prevent duplicate work.

## Phase 0 — Upgrade and install (both machines)

- [ ] `opencode --version` reports **2.x** on both machines.
- [ ] Install/update rules v1.6.0+:
      `git pull` in the rules repo, then `node install.mjs --opencode v2`.
- [ ] Config check on both:
      `permissions` is an array, no deprecated `permission` block, 6 absolute instruction entries,
      and `agents/benchmark.md` exists.
- [ ] `node ~/.config/opencode/bin/agentctl.mjs help` works.
- [ ] Fresh session answers the waiting/status and deployment-policy questions.

Acceptance: the OpenCode 2 config is clean on both, and the rules load without the V2/V1 error.

## Phase 1 — Repository and plan access

On the second machine:

```powershell
git clone https://github.com/<owner>/<project-repo>.git
cd <project-repo>
$env:AGENT_ID = "opencode-second"   # add to the PowerShell profile
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" plan sync
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" status
```

- [ ] `develop` matches `origin/develop`.
- [ ] The plan validates (`agentctl plan validate`).
- [ ] The machine can read `plan/PROJECT.md`, `plan/policy.yaml` and task contracts.
- [ ] `agentctl claim` can create a local worktree (`../worktrees` by default); worktrees and state are
      per machine, never shared over a network drive.

## Phase 2 — Deployment governance prerequisite (critical)

Before the second machine pushes any feature branch:

- [ ] Promote the Vercel allowlist to `main` (owner action; may be explicitly delegated):
      `git switch main && git merge --no-ff develop && git push origin main`.
- [ ] Verify statically that `main` contains
      `git.deploymentEnabled: {"*": false, "main": true, "develop": true}` in both apps.
- [ ] Confirm deploy hooks are 0 and `staging` is absent.

Why: until the allowlist is on the production branch, Vercel may create preview deployments for feature
pushes and consume the daily allowance.

## Phase 3 — Pilot task (small, reversible)

1. Owner/lead assigns one small task from `plan/tasks/` to the second machine.
2. Second machine: `plan sync` → `claim` (auto-creates the worktree) → implement → run the contract
   profile → checkpoint/push → submit.
3. Integrator (primary): fetch, run `agentctl integrate <task>`, verify `origin/develop` and evidence.
4. Both machines: `plan sync`; confirm the task is `done`/`integrated` and the plan is current.

Acceptance:

- [ ] One task completed by the second machine and integrated by the primary.
- [ ] Evidence exists for the integrated tree; no duplicate manual deployment.
- [ ] Both clones agree on the plan revision and `develop` commit.
- [ ] No duplicate claim or lost work; foreign worktrees untouched.

## Phase 4 — Steady state

- One task, one worktree, one branch. `agentctl claim` auto-creates the worktree and enforces
  isolation; contracts own file globs. Hot paths (schema, migrations, generated types) are one task
  at a time.
- Cleanup is smart but manual: `agentctl cleanup` is a dry run; `--apply` removes only clean,
  unclaimed, terminal, remote-preserved worktrees.
- Amendments: Tier 1 self-approved, Tier 2 via a lead, Tier 3 only with owner authorization.
- Integrations are serialized on the primary machine; the second machine never integrates unless
  designated.
- Dispatch subagents for independent light work (exploration, review, docs, log triage); use the
  `benchmark` subagent for performance/resource-sensitive acceptance. The parent records the result
  as evidence; no self-certified benchmarks.
- Resource pressure is a scheduling constraint, not a stop order: continue light work or another task,
  defer heavy checks, and never claim deferred checks passed.
- Deployments: development migrations and `develop` deployments are pre-authorized (prefer the
  integrator push). `main` is owner-reviewed; deploy it only on an explicit owner instruction,
  including the owner-authorized admin path if repository policy blocks it. No other branch previews,
  duplicate deploys or deploy hooks without authorization.
- Releases: agents prepare the version/changelog/tests; the owner tags and publishes. See
  [Versioning](/versioning) and [Releasing](/releasing).
- Weekly: `agentctl report` from the primary; review blocked tasks, amendments and worktree retention.
- Resource limits are measured per machine; heavy jobs are scheduled locally, not assumed.

## Acceptance checklist for the rollout

- [ ] Both machines run OpenCode 2 with the same rules version.
- [ ] Both configs use `permissions` (no deprecated `permission`) and 6 instructions.
- [ ] Both clones read the plan from `origin/develop`.
- [ ] The Vercel allowlist is active on `main`; no accidental preview deployments from feature branches.
- [ ] One pilot task completed end-to-end with evidence.
- [ ] Worktree cleanup remains dry-run until explicitly authorized.

## Risks and limitations

- **No shared atomic claims.** SQLite is per clone; assignment is via the plan/PR. A shared state
  service would be a separate build.
- **Repository access.** The project repository may be private; use your GitHub account or add a
  collaborator. The rules package is public.
- **Deployment quota.** Previews from non-allowlisted branches continue until `main` has the allowlist.
- **No SSH/remote orchestration.** The two machines coordinate through Git; do not mount state over a
  network share.
- **Version drift.** Upgrade the rules deliberately on both machines; the installer reports the
  version. Use `AGENT_ID` per machine.

## References

- [OpenCode 2](/opencode-2) — install/migration and config verification.
- [Worktrees](/worktrees) — auto-create, isolation and cleanup.
- [Subagents](/subagents) — delegation and benchmark standard.
- [Versioning](/versioning) · [Releasing](/releasing)
- [GitHub prompt](https://github.com/J-Akiru5/agentops-rules/blob/main/PROMPT.md)
- `plan/PROJECT.md`, `plan/policy.yaml`, `plan/tasks/` in the project repository — authoritative project
  intent and contracts.
- `rules/instructions/team-development.md` — multi-machine operating rules.
