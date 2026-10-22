# Task contract reference

A task is a Markdown file under `plan/tasks/` with YAML frontmatter. The body is for humans. The
frontmatter is machine-validated.

```yaml
---
id: T-0004
title: "Cache the explore query"
milestone: M02-product-polish
priority: P2
status: ready
rev: 1
objective: "Make the explore page respond faster without changing its API."
outcome: "Warm p95 response time is below 300 ms on the fixture dataset."
verification_profile: standard
deployment_impact: code
deployment_verification: "Local build, unit tests and a benchmark subagent comparison; no deployment."
integration_target: develop
dependencies: [T-0001]
ownership:
  - "apps/web/src/app/[locale]/explore/**"
  - "scripts/benchmarks/**"
out_of_scope:
  - "apps/web/supabase/**"
interfaces: []
deliverables:
  - "Cached query path"
  - "Benchmark comparison"
acceptance:
  - "AC1 [test]: explore pagination tests pass"
  - "AC2 [cmd]: apps/web builds successfully"
  - "AC3 [review]: benchmark report shows candidate median within threshold"
constraints_security:
  - "No auth or RLS changes"
constraints_compatibility:
  - "Public URL shape unchanged"
database_migration: none
escalation:
  - "Any schema change"
---
## Context
...
```

## Required fields

| Field | Meaning |
| --- | --- |
| `id` | `T-0000`; must match the filename prefix. |
| `title`, `objective`, `outcome` | What and why; single-line strings. |
| `milestone` | Must exist under `plan/milestones/`. |
| `priority` | Any non-empty string; use P0–P3 by convention. |
| `status` | `draft`, `ready`, `blocked`, `parked`, `done`. Only `ready` is claimable. |
| `rev` | Contract revision. Incremented only by the amendment workflow. |
| `verification_profile` | A profile from `policy.yaml`. |
| `integration_target` | Must equal the policy target (`develop`). |
| `dependencies` | Task IDs that must be integrated before claim. |
| `ownership` | Exclusive globs. A claim is refused on overlap with another active claim. |
| `out_of_scope` | Forbidden globs; a diff matching one is refused. |
| `interfaces`, `deliverables` | Lists. |
| `acceptance` | `ACn [test|cmd|review]: text` entries. |
| `constraints_security`, `constraints_compatibility` | Lists of constraints. |
| `database_migration` | `none`, `additive`, `non_additive`. |
| `escalation` | Conditions that require the owner/lead. |

## Deployment metadata

If `ownership` overlaps `deployment.sensitive_paths`, the contract must declare
`deployment_impact` (`none`, `code`, `config`). When impact is not `none`, `deployment_verification`
is required and must explain how the change is verified **without deploying**. The claim and the
integrator refuse a sensitive diff that claims `none`.

## Acceptance syntax

```text
AC1 [test]: <what is checked>
AC2 [cmd]: <command and expected outcome>
AC3 [review]: <what a reviewer must confirm>
```

At least one is required. An acceptance criterion that cannot be verified should be rewritten or
escalated — not weakened silently.

## Revision vs version

`rev` is an amendment revision. It is not semver. Package/tool releases follow
[Versioning](/versioning); contract changes use the amendment workflow.

## Runtime view

Assignee, worktree, branch, lease, evidence and state are **not** in the file. See them with:

```powershell
agentctl task show <T-0000> --agent <id>
agentctl status
```
