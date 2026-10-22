# Team development plan — OpenCode 2 + AgentOps

Status: ready to execute
Owner: project owner (human)
Integrator machine: LOQ
Second machine: the owner’s other laptop (OpenCode 2)
Repository: `J-Akiru5/lagavista` (private)
Rules package: `J-Akiru5/agentops-rules` (private, v1.4.0+)

## Objective

Operate a two-machine team on Lagavista with identical OpenCode 2 rules, isolated worktrees, validated
task contracts, evidence-based verification, and a single deterministic integrator. Avoid duplicate
claims, lost work, and unnecessary Vercel deployments.

## Roles

| Role | Machine | Responsibilities |
| --- | --- | --- |
| Owner | any | Promotes `main`, approves Tier-3 amendments, controls deployment quota decisions. |
| Integrator | LOQ | Runs `agentctl integrate`, pushes `origin/develop`, owns the final verified state. |
| Implementer | laptop 2 | Claims assigned tasks, works in a task worktree, verifies locally, pushes the task branch. |
| Lead (optional) | either | Approves Tier-2 amendments; must differ from the proposer. |

Runtime state (`.git/agentops/state.db`) is **local to each clone**. The two machines do not share
claims. Task assignment in the plan/PR and branch ownership prevent duplicate work.

## Phase 0 — Upgrade and install (both machines)

- [ ] `opencode --version` reports **2.x** on both machines.
- [ ] Install/update rules v1.4.0+:
      `git pull` in the rules repo, then `node install.mjs --opencode v2`.
- [ ] Config check on both:
      `permissions` is an array, no deprecated `permission` block, 5 absolute instruction entries.
- [ ] `node ~/.config/opencode/bin/agentctl.mjs help` works.
- [ ] Fresh session answers the waiting/status and deployment-policy questions.

Acceptance: the OpenCode 2 config is clean on both, and the rules load without the V2/V1 error.

## Phase 1 — Repository and plan access

On laptop 2:

```powershell
git clone https://github.com/J-Akiru5/lagavista.git
cd lagavista
$env:AGENT_ID = "opencode-laptop2"   # add to the PowerShell profile
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" plan sync
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" status
```

- [ ] `develop` matches `origin/develop`.
- [ ] The plan validates (`agentctl plan validate`).
- [ ] The machine can read `plan/PROJECT.md`, `plan/policy.yaml` and task contracts.
- [ ] `agentctl claim` can create a local worktree (`../worktrees` by default); worktrees and state are
      per machine, never shared over a network drive.

Acceptance: laptop 2 reads the same authoritative plan from `origin/develop`; no stale checkout edits.

## Phase 2 — Deployment governance prerequisite (critical)

Before laptop 2 pushes any feature branch:

- [ ] Promote the Vercel allowlist to `main` (human only):
      `git switch main && git merge --no-ff develop && git push origin main`.
- [ ] Verify statically that `main` contains
      `git.deploymentEnabled: {"*": false, "main": true, "develop": true}` in both apps.
- [ ] Confirm deploy hooks are 0 and `staging` is absent.

Why: until the allowlist is on the production branch, Vercel creates preview deployments for feature
pushes and consumes the daily allowance.

## Phase 3 — Pilot task (small, reversible)

1. Owner/lead assigns one small task from `plan/tasks/` to laptop 2.
2. Laptop 2: `plan sync` → claim → implement in a task worktree → run the contract profile →
   checkpoint/push → submit.
3. Integrator (LOQ): fetch, run `agentctl integrate <task>`, verify `origin/develop` and evidence.
4. Both machines: `plan sync`; confirm the task is `done`/`integrated` and the plan is current.

Acceptance:

- [ ] One task completed by laptop 2 and integrated by the LOQ.
- [ ] Evidence exists for the integrated tree; no manual deployment.
- [ ] Both clones agree on the plan revision and `develop` commit.
- [ ] No duplicate claim or lost work; foreign worktrees untouched.

## Phase 4 — Steady state

- One task, one worktree, one branch. `agentctl claim` auto-creates the worktree and enforces
  isolation; contracts own file globs. Hot paths (schema, migrations, generated types) are one task
  at a time.
- Cleanup is smart but manual: `agentctl cleanup` is a dry run; `--apply` removes only clean,
  unclaimed, terminal, remote-preserved worktrees.
- Amendments: Tier 1 self-approved, Tier 2 via a lead, Tier 3 only with owner authorization.
- Integrations are serialized on the LOQ; laptop 2 never integrates unless designated.
- Dispatch subagents for independent light work (exploration, review, docs, log triage); use the
  `benchmark` subagent for performance/resource-sensitive acceptance. The parent records the result
  as evidence; no self-certified benchmarks.
- Resource pressure is a scheduling constraint, not a stop order: continue light work or another task,
  defer heavy checks, and never claim deferred checks passed.
- Deployments: only `main` (human promotion) and `develop` (integrator push). No previews, no manual
  `vercel deploy`, no deploy hooks without authorization.
- Weekly: `agentctl report` from the LOQ; review blocked tasks, amendments and worktree retention.
- Resource limits are measured per machine; heavy jobs are scheduled locally, not assumed.

## Acceptance checklist for the rollout

- [ ] Both machines run OpenCode 2 with the same rules version.
- [ ] Both configs use `permissions` (no deprecated `permission`).
- [ ] Both clones read the plan from `origin/develop`.
- [ ] The Vercel allowlist is active on `main`; no accidental preview deployments from feature branches.
- [ ] One pilot task completed end-to-end with evidence.
- [ ] Worktree cleanup remains dry-run until explicitly authorized.

## Risks and limitations

- **No shared atomic claims.** SQLite is per clone; assignment is via the plan/PR. A shared state
  service would be a separate build.
- **Second-machine access.** The rules and project repos are private; use your GitHub account or add a
  collaborator.
- **Deployment quota.** Previews from non-allowlisted branches continue until `main` has the allowlist.
- **No SSH/remote orchestration.** The two machines coordinate through Git; do not mount state over a
  network share.
- **Version drift.** Upgrade the rules deliberately on both machines; the installer reports the
  version. Use `AGENT_ID` per machine.

## References

- [`OPENCODE-2.md`](OPENCODE-2.md) — install/migration and config verification.
- [`../PROMPT.md`](../PROMPT.md) — copy-paste install prompt.
- `plan/PROJECT.md`, `plan/policy.yaml`, `plan/tasks/` in the Lagavista repository — authoritative
  project intent and contracts.
- `rules/instructions/team-development.md` — multi-machine operating rules.
