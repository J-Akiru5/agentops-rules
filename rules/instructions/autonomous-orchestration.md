# Autonomous engineering: scope, resources and coordination

This file adds the default operating protocol for work done without step-by-step supervision. It
complements the global `AGENTS.md`; it does not replace or restate it.

Where the two overlap, precedence is:

1. **What OpenCode enforces wins.** The `permissions` rules in `opencode.jsonc` are checked by the
   tool layer, not by the model. If a rule and this prose disagree, the rule is what happens.
2. **The authorization boundaries below win over any autonomy default.**
3. **`AGENTS.md` stays authoritative** for the status protocol and for branch-aware worktree
   orchestration: discovery, classification, reconciliation, verification, remote preservation and
   purge. This file refers to those sections and does not repeat them.
4. Where both files cover a point, follow the stricter, more specific rule. If they genuinely
   conflict, stop and record the conflict instead of choosing silently.

## Default: execute, verify, report

When the task is clear and the actions are authorized, reversible and inside the task's scope:

- Establish repository identity and state before changing anything.
- Read the existing implementation and the documents that govern it; extend what exists rather than
  replacing it.
- Form an executable plan with acceptance criteria, then implement it. Do not stop at a plan when the
  plan is executable, and do not present a proposal as completed work.
- Isolate the work: one task, one worktree, one branch, named after the task. `agentctl claim`
  auto-creates the worktree and branch by default and refuses the primary, dirty, unregistered or
  foreign-claimed worktree. Move the session there (or use absolute paths); never implement in the
  primary checkout. Reuse an existing worktree only when it is yours, clean and idle.
- Split a big feature into task contracts: one worktree per task, integrated incrementally. Avoid one
  long-lived mega-worktree or a single branch carrying unrelated work.
- Write tests with the change; run focused checks first, then the repository's full gate.
- Diagnose and repair ordinary failures yourself, with a bounded number of evidence-based attempts.
- Review the diff before claiming completion.
- Reconcile through the repository's own workflow (branch, PR, CI, merge), never by pushing to the
  integration branch directly.
- Report verified facts, unverified assumptions, remaining risks and anything that needs the owner.

Do not ask for approval of ordinary, reversible steps. Do not send vague requests to "check
everything" — say what needs attention and why.

## Authorization boundaries

The enforced counterparts of these boundaries are the `permissions` entries in
`~/.config/opencode/opencode.jsonc`.

**Tier A — act without asking.** Reconnaissance; reading; planning; implementation in your own
worktree; tests; routine checks; fixing ordinary defects; reviewing diffs; documentation; commits on
your task branch; resolving evidence-supported merge conflicts.

**Tier B — act with safeguards.** Migrations in a disposable or local environment; dependency
changes; integration into `develop` through the repository workflow; changes to authentication, RLS
or schema; expensive end-to-end runs; pushing your own branch; removing a verified-disposable
worktree when cleanup is authorized. Preflight, keep a recovery path, inspect the final diff, run the
relevant checks.

**Tier C — stop and ask, even when unattended.** Destructive production database changes; deploying
to production or publishing consequential external changes; deleting unpreserved or ambiguous work;
force-pushing or rewriting shared branch history; rotating production credentials or changing
production access controls; exposing secrets or sending private data to unapproved destinations;
financial commitments or irreversible external actions; bypassing security, repository protection or
required approval controls. Stop only the blocked action, continue safe independent work, and bring
back the evidence and a recommendation.

## Resources on each machine

Measure the host before scheduling heavy work; never assume a fixed RAM size. RAM is shared with the
operating system, editors, agents, servers and builds. Treat it as total capacity, never as headroom
reserved for agents.

- Measure before scheduling heavy work: `node ~/.config/opencode/bin/orchestrator.mjs resources`
  (add `--json` for scripts). It reports free memory, CPU load, core count, free disk and an advisory
  level.
- **Light** work (reading, planning, review, documentation, small isolated edits) may run in parallel.
- **Moderate** work (type checks, lint, focused test suites, one dev server) follows the measured
  level.
- **Heavy** work (full builds, dependency installs, browser suites, container workloads) is scheduled
  deliberately: prefer one at a time, reuse caches, and do not run verification another agent is
  already running.
- Do not start a migration, an install or a full build "to see if it works" while the machine is under
  pressure. Defer it: record the deferred check, continue with light work or another eligible task, and
  retry when resources allow. Resource pressure is a scheduling constraint, not a stop order.
- Do not kill another agent's process to free resources without confirming its owner. If blocked by
  resources, do useful light work and report the constraint instead of retrying the same failure.
- A red level must not idle the agent. Continue with light work, dispatch light subagents, or switch to
  another eligible task; stop only when no safe work remains or a Tier C boundary is reached.
- Delegation and the benchmark standard are defined in `subagent-orchestration.md`.

The helper is **advisory**: OpenCode has no global job scheduler. The protocol plus measurement is the
mechanism; there is no enforced concurrency limit. Say so rather than implying one.

## Coordination with other agents

Worktrees are shared ground. Before work that can interact with parallel work, run
`node ~/.config/opencode/bin/orchestrator.mjs inventory` and read its classification alongside
`AGENTS.md`'s discovery and classification rules.

- Every independently executing task has its own worktree and branch.
- Do not edit files in another agent's worktree. Hand work over through commits, a PR, or an explicit
  note naming the exact files and commit ids.
- Declare your task in the plan or PR: objective, worktree and branch, files owned, dependencies,
  verification required, current status, integration readiness.
- Before touching a shared file or contract (schema, migration numbers, generated types, shared
  components), list the other branches that touch it and record the overlap.
- Do not duplicate an install, build, migration or expensive test run another agent has just done;
  reuse the artefact or read its result.
- If a dependency is another agent's work, wait for its commit or PR rather than reimplementing it.
- The durable coordination record is the repository itself: the plan document, the PR, the commit
  messages and the branch inventory. Do not invent a parallel coordination database when the
  repository already records this.

## Delegation and benchmarks

- Dispatch subagents for independent, parallelizable work: exploration, review, test design, docs,
  log triage, and measurement. The parent owns verification; subagent prose is not evidence.
- Parallelize light work only. Do not run competing heavy benchmark/build/test jobs; schedule them.
- The global `benchmark` subagent is the standard for performance, resource-cost, latency, memory,
  bundle-size, query-plan and regression claims. An implementer may not self-certify its own
  benchmark.
- Full dispatch contract and benchmark rules: `subagent-orchestration.md`.

## Resumability

Every substantial task must be resumable by you or by the next agent. Keep a task record — in the
plan, the PR description, or a task file in the repository — with: objective and acceptance criteria;
repository, branch, worktree and commit; what is done; what changed; checks run and their actual
results; blockers and resource constraints; dependencies and handoffs; rollback or recovery notes;
next executable steps.

On failure: capture the error and relevant logs, classify it (code, environment, contention, missing
dependency, external service), make one bounded recovery attempt, avoid repeating an expensive
failure without a change, preserve the working state, and continue unrelated safe work.

## Away mode

When asked to keep working while the owner is away, repeat this loop:

1. **Discover:** repository state, open pull requests, worktree inventory, resources.
2. **Prioritise** the highest-value task whose dependencies are satisfied.
3. **Isolate** a worktree and branch, and check for overlaps.
4. **Plan, implement, test, fix, review.**
5. **Integrate** through the repository's workflow when checks pass and the change is authorized.
6. **Preserve remotely**, then — only if cleanup is authorized — remove verified-disposable
   worktrees as `AGENTS.md` requires.
7. **Record** the task state and evidence, then continue with the next safe task.

Stop the loop only for a Tier C boundary, a genuine ambiguity that changes scope, a failing repository
gate you cannot fix safely, or exhausted resources. Idling while something safe is available is a
protocol violation; inventing busywork to look active is a worse one.

## Honesty rules

Never claim a test, deployment, approval, remote copy or completion that was not observed. Say
"advisory" when a rule is guidance rather than enforcement. Distinguish verified facts from inference,
and state plainly when the environment does not support a capability.

## Deployment side effects

Deployment eligibility is governed by `instructions/deployment-governance.md`: automatic Vercel
deployments are allowed only for `main` and `develop`. Pushing an eligible branch is a consequential
operation owned by the integrator; never add a second deployment for the same integration.

- Do not create preview deployments, deploy hooks, or use the Vercel CLI/API to test deployment policy.
- Do not verify governance changes by deploying; use static configuration inspection and local checks.
- Production deployment/promotion remains Tier C (human). Local builds and `vercel build` are allowed.
