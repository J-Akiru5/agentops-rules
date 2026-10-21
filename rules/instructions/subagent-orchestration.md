# Subagent orchestration and benchmarking

Subagents are how work continues when one thread is blocked, when a question is independent, or when
a claim needs independent evidence. They do not replace the task owner, the integrator, or the
definition of done.

## When to dispatch

Use subagents for independent, parallelizable, or context-heavy work:

- codebase exploration and architecture mapping;
- test design, adversarial review, security review;
- documentation and migration research;
- log triage and failure reproduction;
- benchmarking and performance measurement.

Do not dispatch a subagent to:

- bypass permissions, deployment rules, or a blocked decision;
- duplicate a task another agent or session is actively working on;
- replace a sequential step you can finish directly;
- self-approve a change the parent is supposed to review.

## Dispatch contract

Every subagent prompt must state:

- objective and the exact question to answer;
- repository, worktree, branch, and task ID;
- allowed scope and files; whether it is read-only or may write;
- resource class (light/moderate/heavy) and a budget;
- expected output and evidence (commands, results, file/line references);
- prohibitions: no deployments, no pushes, no main/develop writes, no worktree resets;
- whether it may launch further subagents (default: no).

Subagents follow every global rule, including the waiting/status protocol, branch-aware worktree
orchestration, deployment governance, and the local-state limitation. The parent verifies their
output; a subagent's prose is never evidence by itself.

## Resource pressure and delegation

- Subagents share the same machine budget. Parallelize **light** work; schedule heavy benchmark,
  build, install, and test subagents one at a time.
- A red level is a scheduling constraint, not a stop order. Keep working on light tasks, dispatch
  light subagents, or pick another eligible task; defer heavy checks.
- Never claim a deferred check passed. Record the deferral and retry when resources allow.
- Do not kill another agent's or subagent's process to free resources without confirming its owner.

## Benchmark subagent standard

Use the global `benchmark` subagent whenever a decision or acceptance criterion depends on
performance, resource use, or measured behavior. Relevant cases include:

- latency, throughput, memory, bundle size, build/test duration, or startup time;
- UI rendering, animation smoothness, or perceived responsiveness;
- database query plans, index changes, or pagination strategy;
- library/framework comparisons and upgrade impact;
- resource-cost claims from the resource scheduler;
- any task whose acceptance criteria mention speed, memory, cost, or capacity.

The benchmark subagent is read-only by default. It must not edit source, install dependencies, push,
or deploy. Its report must include:

1. Objective and hypothesis.
2. Baseline and candidate commits/trees.
3. Workload and dataset used.
4. Metric(s), repetitions, warm-up, and environment.
5. Median and spread (not a single sample).
6. Resource level during measurement and any contention.
7. Limitations and confidence.
8. A recommendation with the evidence attached.

The implementing agent may not self-certify its own benchmark. The parent records the benchmark result
as evidence and, where it affects acceptance, treats it as a verification input. If the measurement
cannot run under the current resource level, the benchmark agent reports the deferral; do not replace
it with intuition or invented numbers.

For trivial or non-measurable changes, state why a benchmark is not meaningful and rely on static
reasoning instead.
