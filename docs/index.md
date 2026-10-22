---
layout: home

hero:
  name: AgentOps Rules
  text: Verifiable autonomy for coding agents
  tagline: Canonical intent, transactional state, tree-bound evidence, isolated worktrees, serialized integration, safe deployments and measurable subagents — for OpenCode.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/J-Akiru5/agentops-rules

features:
  - title: Intent → State → Evidence
    details: Versioned contracts on develop, SQLite claims/leases in the Git common directory, and verification evidence keyed to the exact tree.
  - title: Isolated worktrees by default
    details: agentctl claim creates the task worktree and branch, refuses the primary checkout and dirty/foreign trees, and prints the path to move to.
  - title: Deterministic integration
    details: A serialized integrator merges a candidate, verifies it, commits evidence, advances develop by compare-and-swap, and verifies origin.
  - title: Development-first deployment
    details: Development migrations and develop deployments are pre-authorized. Main is owner-reviewed and deployed when explicitly instructed, including an authorized admin path when repo policy blocks it.
  - title: Resource-aware, not resource-blocked
    details: Red/amber levels defer heavy work and continue light work, another task, or light subagents. Deferred checks are recorded, never claimed as passed.
  - title: Measured claims
    details: A read-only benchmark subagent produces baseline/candidate results with repetitions, spread, environment and limitations. Implementers cannot self-certify.
---
