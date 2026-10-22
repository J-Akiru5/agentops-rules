# Subagents and the benchmark standard

Full rules: [subagent-orchestration.md](https://github.com/J-Akiru5/agentops-rules/blob/main/rules/instructions/subagent-orchestration.md).
The global `benchmark` subagent is installed at `~/.config/opencode/agents/benchmark.md`.

## When to dispatch

Use subagents for independent, parallelizable or context-heavy work:

- codebase exploration and architecture mapping;
- test design, adversarial review, security review;
- documentation and migration research;
- log triage and failure reproduction;
- benchmarking and performance measurement.

Do not dispatch to bypass permissions, duplicate an active claim, or replace a sequential step you can
finish directly. Subagents follow all global rules; the parent verifies their output.

## The benchmark subagent

Use the `benchmark` subagent when a decision or acceptance criterion depends on measured behavior:

- latency, throughput, memory, bundle size, startup time, build/test duration;
- UI rendering or animation smoothness;
- database query plans, indexes or pagination;
- library/framework comparisons or upgrade impact;
- resource-cost claims;
- any contract acceptance criterion mentioning speed, memory, cost or capacity.

It is read-only (edits denied), cannot push, deploy, install dependencies or reset worktrees, and
reports:

1. objective and hypothesis;
2. baseline and candidate commits/trees;
3. workload and dataset;
4. metric(s), repetitions, warm-up and environment;
5. median and spread (at least three samples);
6. resource level and contention;
7. limitations and confidence;
8. recommendation and the evidence the parent should record.

The implementing agent cannot self-certify its own benchmark. If the measurement cannot run under the
current resource level, the subagent reports a deferral; the parent records it and continues with
light work instead of inventing numbers.

## Example dispatch

```text
Use the benchmark subagent to compare the current branch against develop for the Iloilo explore page.
Baseline: origin/develop. Candidate: current HEAD. Workload: production build, 100 page requests,
5 repetitions after warm-up. Metrics: p50/p95 server response time, first-load JS bytes. Environment:
this machine, current resource level. Read-only; do not edit, push or deploy. Return the full report
with commands and evidence.
```

## Resource pressure

- Red is a scheduling constraint, not a stop order. Continue with light work, dispatch light subagents,
  or pick another eligible task.
- Heavy benchmark/build/test subagents run one at a time; do not run competing heavy jobs.
- Deferred checks are recorded; never claim them passed.
- If no safe work remains, report the exact blocker and wait.
