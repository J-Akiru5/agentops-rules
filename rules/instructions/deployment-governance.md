# Vercel deployment governance

This file is authoritative for deployment eligibility and deployment side effects. It extends
`AGENTS.md`, `autonomous-orchestration.md` and `agentops-backbone.md`; it replaces no other rule.
Where instructions overlap, deployment eligibility is governed here; who may merge and push remains
governed by the existing integration and branch-ownership protocol.

## Eligibility allowlist (strict)

Only these branches are eligible for automatic Vercel deployments:

- `main`
- `develop`

Every other branch is **ineligible by default**, including `staging` (no staging application is
used), feature branches, agent/`agent/*` branches, temporary worktree branches, experiment and
benchmark branches, Dependabot branches, and any branch not named above. Pull-request preview
deployments inherit this rule: previews from non-allowlisted branches are prohibited.

An unknown branch is ineligible. Eligibility is not permission to push: existing branch ownership,
integration, review and promotion rules stay authoritative.

- `develop` is the integration branch. Only the deterministic integrator pushes it, after verified
  integration.
- `main` is the production branch. Agents must never promote to `main`; promotion is human-only.

## Agent prohibitions

Unless the owner explicitly authorizes a specific deployment:

- Do not run `vercel`, `vercel deploy`, `vercel --prod`, `vercel promote`, `vercel redeploy`, or
  `vercel rollback` to create or move deployments.
- Do not create preview deployments during routine development, review, or "just to check".
- Do not create deploy hooks, invoke deployment webhook URLs, or call deployment APIs.
- Do not push temporary branches to observe deployment behavior.
- Do not trigger a deployment to test whether this policy works.
- Do not bypass the allowlist through CI workflows, scripts, hooks, plugins, or alternate
  deployment mechanisms.
- Do not repeatedly push commits to eligible branches for minor intermediate updates; consolidate
  work into sensible integration batches.

Allowed without deployment side effects: local builds, type checks, linting, unit/integration tests,
and local `vercel build` when justified (it does not create a deployment). Avoid unnecessary
resource-intensive builds; the resource protocol still applies.

Agents must keep these operations distinct: local verification · Git push · automatic deployment
from an eligible branch · explicit deployment creation · production promotion. Each has separate
permissions.

## Integration behavior

1. Work in an isolated worktree and branch.
2. Run local checks and the contract's verification profile.
3. Submit to the integrator; the integrator reconciles into `develop` and pushes `origin/develop`
   only under the existing protocol.
4. The eligible-branch Git integration performs the one automatic deployment. Agents must not
   trigger a second deployment for the same integration.
5. Production deployment happens only when a human promotes to `main`. Agents do not push `main`.

Deployment-configuration changes are validated statically (configuration inspection, diffs, local
scripts). Never validate them by deploying.

## Task contracts and definition of done

Every contract whose ownership can affect deployment must declare:

- `deployment_impact`: `none`, `code`, or `config`.
- `deployment_verification` (required when impact is not `none`): how the change is verified without
  deploying, e.g. static configuration checks and local builds.
- Whether the change adds a deployment pathway; new pathways require explicit authorization.

Deployment-sensitive paths are declared in the project policy (`plan/policy.yaml` →
`deployment.sensitive_paths`) and enforced by `agentctl plan validate` and the integrator. A task
whose diff touches them while claiming `deployment_impact: none` is refused.

Integration into `develop` triggers the one allowed automatic deployment. Treat that push as a
consequential operation, not an ordinary verification step, and never follow it with a manual deploy.

## First-instantiation checklist (every project, every first ownership)

- [ ] Discover repository, branch model, and integration branch.
- [ ] Discover the linked Vercel project (if any).
- [ ] Identify the actual production branch.
- [ ] Inspect Git-based deployment settings and Preview deployment behavior.
- [ ] Inspect CI workflows, package scripts, hooks, deployment APIs, and webhooks.
- [ ] Configure or verify the `main` + `develop` allowlist in each project's `vercel.json`.
- [ ] Verify `staging` is excluded (no branch, no custom environment, no eligible config).
- [ ] Verify feature/temporary branches cannot deploy through automatic pathways.
- [ ] Identify duplicate deployment pathways (Actions, Docker, CLI, hooks, APIs).
- [ ] Record unavoidable platform limitations and dashboard changes that still require the owner.
- [ ] Add project-specific notes only where the global policy cannot express the actual configuration.

Do not assume a project is correct because this rule exists; inspect it. If a project has no Vercel
integration, record that and do not create one without authorization.

## Enforcement mechanisms and limits

- **Primary: `git.deploymentEnabled` in `vercel.json`** — minimatch branch map. `{"*": false,
  "main": true, "develop": true}` prevents deployment creation for every other branch, including
  pull-request previews. This happens before a build starts.
- **Not used: Ignored Build Step** — canceled builds still count toward Vercel deployment and
  concurrent build limits; it is not a quota-saving substitute for `git.deploymentEnabled`.
- **Project settings:** production branch must be `main`. Preview deployment behavior must be
  verified per project. Deploy hooks are deployment pathways: remove unauthorized ones.
- **Outside Vercel Git integration:** CLI/API/agent deploys, deploy hooks, and third-party
  integrations are not controlled by `vercel.json`. They are controlled by permissions, the
  prohibitions above, and deletion of unused hooks. Do not claim platform enforcement where only a
  policy rule exists.
- Changes to `git.deploymentEnabled` take effect according to Vercel's configuration loading. If
  the platform reads configuration from a branch other than the one being deployed, promotion to
  `main` may be required before enforcement applies to every branch. Report this honestly instead of
  claiming verification that required a deployment.

## Validation and reporting

Static verification only: inspect `vercel.json`, workflows, scripts, hooks, project settings, deploy
hooks, and recent deployment history. Never create a deployment to prove a policy. Distinguish:

- **Verified enforcement** — configuration inspected and static checks pass.
- **Policy-only** — instruction exists, but no platform control can enforce it (e.g. a human running
  `vercel --prod` outside agent permissions).
- **Unverified** — would require a deployment to prove; report it as such.

Reports must state: eligible branches; enforcement mechanisms implemented; hooks/pathways removed;
whether any deployment was triggered; and remaining dashboard actions or bypass paths.
