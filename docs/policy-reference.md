# Policy reference

`plan/policy.yaml` is read through `origin/develop`. Missing sections fall back to defaults shown
here. Validate with `agentctl plan validate`.

```yaml
version: 1

integration:
  target_branch: develop
  remote: origin
  protected_branches: [main, staging]
  require_source_on_remote: true
  allow_agents: [integrator, lead]

claims:
  lease_minutes: 15

amendments:
  tiers:
    objective_changed: 3
    acceptance_changed: 3
    check_downgraded: 3
    acceptance_added: 1
    scope_narrowed: 1
    scope_widened: 2
    ownership_changed: 2
    dependencies_added: 1
    dependencies_removed: 3
    verification_changed: 2
    interface_changed: 2
    migration_additive: 2
    migration_non_additive: 3
    default: 2
  tier2_requires_role: lead

verification:
  profiles:
    docs:
      resource_class: light
      commands: [node scripts/agentops/check-plan.mjs]

deployment:
  provider: vercel
  allowed_branches: [main, develop]
  production_branch: main
  excluded_branches: [staging]
  sensitive_paths:
    - "vercel.json"
    - "apps/*/vercel.json"
    - ".github/workflows/**"
    - "package.json"
    - "apps/*/package.json"
    - "pnpm-lock.yaml"
    - "apps/**"
    - "packages/**"

worktree:
  root: ../worktrees
  branch_prefix: feature
  base: origin/develop
  auto_create: true
  require_isolated_claim: true

resources:
  classes: [light, moderate, heavy]
  exclusive: [db-dev]

database:
  tool: db_migrate
  dev_project_ref: null
  production_project_refs: []
  env_file: apps/web/.env.local
  migrate_command: null
  verify_command: null
  lease_minutes: 30
  resource_class: light

cleanup:
  require_apply_flag: true
```

## Integration

`target_branch` is the only branch the integrator advances. Protected branches cannot be claimed or
integrated from. `allow_agents` lists the roles permitted to run `integrate`.

## Verification profiles

Each profile has a `resource_class` (`light`, `moderate`, `heavy`) and a non-empty command list. The
contract's `verification_profile` must exist. Profiles run through resource admission and record
evidence.

## Deployment

The allowlist is strict. `*` must be false in `vercel.json`; only `main`/`develop` are true. Staging is
excluded. Development migrations and `develop` deployments are pre-authorized; a `main` deployment
requires an explicit owner instruction. Contracts touching `sensitive_paths` must declare
`deployment_impact`; `none` is refused when the diff touches them. See
[Deployment governance](/deployment-governance).

## Worktree

`root` is resolved relative to the repository (or may be absolute). `base` should be a remote-tracking
ref. `auto_create` makes `claim` create the worktree; `require_isolated_claim` enforces registered,
clean, non-primary worktrees when `--worktree` is supplied. Set both to `false` only for deliberate
manual management.

## Resources

Every command takes an expiring reservation. Light is always admitted. Moderate/heavy are deferred
under pressure with an explicit message; the task state is not failed. `exclusive` lists named locks
(for example the shared development database).

## Database

`dev_project_ref` is matched against the connection URL's host **and username** (Supabase pooler URLs
carry the ref in the username). `production_project_refs` are rejected. The connection string is never
printed. `migrate_command` is the repository's migration entrypoint.

## Cleanup

`require_apply_flag: true` keeps cleanup as a dry run unless `--apply` is passed. The command itself
checks dirtiness, claims, task state, protected branches, remote preservation and locks.
