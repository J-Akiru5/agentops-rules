# Vercel deployment governance

This file is authoritative for deployment eligibility and deployment side effects. It extends
`AGENTS.md`, `autonomous-orchestration.md` and `agentops-backbone.md`; it replaces no other rule.
Where instructions overlap, deployment authorization is governed here; who may merge and push remains
governed by the integration and branch-ownership protocol.

## Branch eligibility

Automatic Git deployments are allowed only for:

- `main` — production
- `develop` — development/integration

Every other branch is **ineligible by default**, including `staging` (no staging application is used),
feature branches, agent/`agent/*` branches, temporary worktree branches, experiment and benchmark
branches, Dependabot branches, and any branch not named above. Pull-request preview deployments
inherit this rule: previews from non-allowlisted branches are prohibited.

Unknown branches are ineligible. Eligibility is not push permission: branch ownership, integration
and review rules still apply, except where an explicit owner instruction authorizes a main deployment.

## Authorization defaults

| Action | Default |
| --- | --- |
| Migration against the verified **development** database | **Authorized** — apply without asking |
| Deployment of `develop` | **Authorized** — prefer the integrator/Git deployment |
| Manual deployment of `develop` | **Authorized** only when the Git deployment is unavailable; do not duplicate |
| Deployment/promotion of `main` | **Owner review by default**; explicit owner instruction authorizes it |
| Deployment of any other branch | Not authorized |
| Production database migration | Not authorized — separate owner decision required |

### Development migrations

- Apply development migrations autonomously against the target verified by `agentctl db status` (or
  the project's documented equivalent). This is expected work, not a reason to stop and ask.
- `agentctl db push` takes the exclusive `db-dev` lease, runs the configured migration command,
  records evidence and never prints the connection string.
- Never use production credentials, production data or a production project ref. If the target cannot
  be verified, stop that database operation and report the exact uncertainty.
- Do not say "the owner applies migrations" for the development project. Do not ask the owner to run a
  development migration that the agent can verify and apply.
- A main/production deployment instruction is **not** production database authorization. Production
  migrations require a separate, explicit owner decision.

### `develop` deployments

- The integrator push to `develop` is the normal automatic deployment. Do not add a second deployment
  for the same change.
- A manual `develop` deployment is allowed when the Git integration is unavailable, the deployment
  must be retried, or the owner asks for it. Use the development/preview target, not production.
- Do not deploy a feature or agent branch merely to inspect it; use local builds and tests.

### `main` deployments and explicit owner instruction

`main` is production and is owner-reviewed by default. Agents do not promote or deploy `main`
unsolicited.

When the owner explicitly instructs a main/production deployment — for example "deploy to main",
"promote this to production", or "ship main" — that instruction is authorization for that specific
deployment:

1. Perform the normal reviewed promotion/deployment without asking for a second confirmation.
2. If GitHub branch protection, required reviews, a merge queue or another repository policy blocks the
   normal path, use the owner-authorized admin/deployment path rather than refusing solely because the
   policy says agents do not deploy `main`.
3. Use the least invasive path. Record what was used and any protection that had to be bypassed.
4. Never force-push, rewrite shared history, delete branches/tags, disable a protection permanently,
   or change production access controls as part of the deployment.
5. If the only available path requires one of those destructive actions, stop and report the exact
   blocker and the safe alternative.

This is a per-instruction authorization. It does not authorize future main deployments, unrelated
changes, production migrations, tag/release publication, or a permanent policy bypass.

## Prohibited / guarded actions

- Do not deploy to feature, agent, temporary, experiment, Dependabot or unknown branches; do not create
  preview deployments "just to check".
- Do not create deploy hooks, invoke deployment webhook URLs or call deployment APIs unless the owner
  explicitly authorizes that mechanism for a named deployment.
- Do not trigger a deployment to test whether the policy works. Validate configuration statically.
- Do not repeatedly push commits to eligible branches for minor intermediate updates; consolidate.
- Do not run `vercel rollback` without explicit authorization; rollback is a production-impacting
  operation, not a deployment shortcut.
- Local builds, type checks, linting, unit/integration tests and `vercel build` create no deployment
  and are allowed subject to resource admission.

Agents must keep these operations distinct: local verification / Git push / automatic `develop`
deployment / explicit `develop` deployment / explicit `main` deployment. Each has separate authority.

## Integration behavior

1. Work in an isolated worktree and branch.
2. Run local checks and the contract's verification profile.
3. Submit to the integrator; the integrator reconciles into `develop` and pushes `origin/develop`
   under the existing protocol.
4. The eligible-branch Git integration performs the one automatic `develop` deployment. Do not trigger
   a second deployment for the same integration.
5. Apply authorized development migrations through the development database path; never production.
6. For `main`, wait for an explicit owner instruction. Then promote/deploy the reviewed commit, use the
   owner-authorized admin path if repository policy blocks it, and report the result.
7. A main deployment does not authorize a production migration. If the release requires one, stop and
   request a separate production-database decision.

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
consequential operation, not an ordinary verification step, and do not follow it with a duplicate
manual deploy. A later explicit main deployment is a separate authorized action.

## First-instantiation checklist (every project, every first ownership)

- [ ] Discover repository, branch model and integration branch.
- [ ] Discover the linked Vercel project, if any.
- [ ] Identify the actual production branch.
- [ ] Inspect Git deployment settings and Preview deployment behavior.
- [ ] Inspect CI workflows, package scripts, hooks, deployment APIs and webhooks.
- [ ] Configure/verify the `main` + `develop` allowlist in each app's `vercel.json`.
- [ ] Verify `staging` is excluded (no branch, no custom environment, no eligible config).
- [ ] Verify feature/temporary branches cannot deploy through automatic pathways.
- [ ] Identify duplicate deployment pathways (Actions, Docker, CLI, hooks, APIs).
- [ ] Record platform limitations and remaining dashboard actions.
- [ ] Add project-specific notes only where the global rule cannot express the configuration.
- [ ] Confirm the owner knows that an explicit main instruction is the production authorization.

Do not assume a project is correct because this rule exists; inspect it. If a project has no Vercel
integration, record that and do not create one without authorization.

## Enforcement mechanisms and limits

- **Automatic Git deployments: `git.deploymentEnabled` in `vercel.json`.** The minimatch branch map
  `{"*": false, "main": true, "develop": true}` prevents automatic deployment creation for every other
  branch, including pull-request previews. This happens before a build starts.
- **CLI/API deployments are not controlled by `vercel.json`.** They are governed by the authorization
  rules and permission entries above. An explicit owner main instruction may use the CLI/API or an
  admin merge where the Git path is blocked.
- **Not used: Ignored Build Step** — canceled builds still count toward Vercel deployment and
  concurrent build limits; it is not a quota-saving substitute for `git.deploymentEnabled`.
- **Project settings:** production branch must be `main`. Preview deployment behavior must be verified
  per project. Deploy hooks are deployment pathways: remove unauthorized ones.
- Changes to `git.deploymentEnabled` take effect according to Vercel's configuration loading. If the
  platform reads configuration from a branch other than the one being deployed, promotion to `main`
  may be required before enforcement applies to every branch. Report that honestly.
- An explicit owner main instruction does not make unknown branches eligible and does not authorize a
  permanent bypass of repository protections.

## Validation and reporting

Static verification only: inspect `vercel.json`, workflows, scripts, hooks, project settings, deploy
hooks and recent deployment history. Never create a deployment to prove a policy. Distinguish:

- **Verified enforcement** — configuration inspected and static checks pass.
- **Policy-only** — instruction exists, but no platform control can enforce it.
- **Unverified** — would require a deployment to prove; report it as such.

Reports must state: eligible branches; enforcement mechanisms; hooks/pathways removed; whether any
deployment or migration was triggered; any owner authorization used; any protection bypassed; and
remaining dashboard actions or risks.
