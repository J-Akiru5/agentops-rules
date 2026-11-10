# Deployment governance

Automatic Vercel deployments are a limited resource. This protocol uses a strict branch allowlist and
separates **authorization** from permission to push.

## Eligibility

**The repository decides.** Its `vercel.json` (`git.deploymentEnabled`), its own `AGENTS.md` and,
where it uses the AgentOps backbone, `plan/policy.yaml` name the eligible branches, and they must
agree. Agents read them before any push that could deploy and never edit a repository's allowlist to
match the global rule.

Where a repository declares nothing, the default is:

- `main` — production; owner-reviewed by default
- `develop` — development/integration

A repository may use a different non-production branch, for example `staging` as the preview
deployment with `develop` not deploying. On this page "`develop` deployment" means the repository's
eligible non-production branch.

Feature/agent/temporary/experiment branches, Dependabot branches, unknown branches and pull-request
previews from them are never eligible.

## Authorization defaults

| Action | Default |
| --- | --- |
| Development database migration (verified dev target) | **Authorized** — apply without asking |
| `develop` deployment | **Authorized** — prefer the integrator/Git deployment |
| Manual `develop` deployment | Allowed when the Git deployment is unavailable; do not duplicate |
| `main` deployment/promotion | Owner-reviewed by default; an explicit owner instruction authorizes it |
| Any other branch | Not authorized |
| Production database migration | Not authorized — separate owner decision |

### Development migrations and `develop`

- Apply development migrations autonomously against the target verified by `agentctl db status` (or
  the project's equivalent). Do not stop and ask; do not tell the owner to run a development migration
  the agent can verify.
- Prefer the integrator push for `develop`; it performs the one automatic deployment. Do not add a
  duplicate manual deployment for the same change.
- A manual develop deployment is allowed when the Git integration is unavailable, a retry is needed,
  or the owner asks for it. Use the development target, never production.
- Never use production credentials/data. Production migrations remain out of scope.

### `main` and explicit owner instructions

`main` is production and is owner-reviewed by default. Agents do not promote `main` unsolicited.

When the owner explicitly says **“deploy to main”**, **“promote to production”** or **“ship main”**,
that instruction authorizes that specific deployment:

1. Perform the reviewed promotion/deployment without asking for a second confirmation.
2. If GitHub branch protection, required reviews, a merge queue or another repository policy blocks the
   normal path, use the owner-authorized admin/deployment path rather than refusing solely because the
   policy says agents do not deploy `main`.
3. Record what was deployed, the commit, the deployment URL, and any protection that was bypassed.
4. Never force-push, rewrite shared history, delete branches/tags, disable protections permanently or
   change production access controls.
5. If the only path requires a destructive action, stop and report the blocker and a safe alternative.

This authorization is per instruction. It does not authorize future main deployments, unrelated
changes, production migrations, release tags or a permanent policy bypass.

## Prohibited / guarded actions

- Do not deploy feature/agent/temporary/experiment/Dependabot/unknown branches; do not create previews
  "just to check".
- Do not create deploy hooks, invoke deployment webhooks or call deployment APIs unless the owner
  explicitly authorizes that mechanism for a named deployment.
- Do not deploy to test the policy; validate configuration statically.
- Do not run `vercel rollback` without explicit authorization.
- Do not add a second deployment pathway for the same integration.
- `vercel build`, local builds, type checks and tests create no deployment and are allowed subject to
  resource admission.

## Enforcement

Put this in each app's `vercel.json`:

```json
{
  "git": {
    "deploymentEnabled": {
      "*": false,
      "main": true,
      "develop": true
    }
  }
}
```

Vercel matches with minimatch; `*: false` makes unknown branches ineligible, while `main`/`develop` are
explicitly allowed. Pull-request previews inherit the branch rule.

`git.deploymentEnabled` controls **automatic Git deployments**, not CLI/API deployments. CLI/API and
admin merges are governed by the authorization rules and permission entries above. An explicit owner
main instruction may use the owner-authorized admin path when the Git path is blocked.

Do **not** use the Ignored Build Step as a quota substitute: canceled builds still count toward
deployment and concurrent build limits.

## First-instantiation checklist

- [ ] Discover the repository, branch model and integration branch.
- [ ] Discover the linked Vercel project, if any.
- [ ] Identify the production branch.
- [ ] Inspect Git deployment settings and preview behavior.
- [ ] Inspect CI workflows, package scripts, hooks, deployment APIs and webhooks.
- [ ] Read the allowlist in each app's `vercel.json`; if there is none, propose `main` + `develop`
      to the owner.
- [ ] Verify the repository's `AGENTS.md`, CI checks and `plan/policy.yaml` name the same branches.
- [ ] Verify feature/temporary branches cannot deploy through automatic pathways.
- [ ] Identify duplicate deployment pathways.
- [ ] Record platform limitations and remaining dashboard actions.
- [ ] Confirm the owner knows that an explicit main instruction is the production authorization.

## Limits

- CLI/API deploys and deploy hooks are outside `vercel.json`; they are controlled by permissions and
  policy, not platform configuration.
- Vercel may read `git.deploymentEnabled` from the production branch. If the config is only on another
  branch, promotion to `main` may be required before every branch is blocked.
- Never create a deployment to prove the policy; inspect configuration and history instead.

Source: [`rules/instructions/deployment-governance.md`](https://github.com/J-Akiru5/agentops-rules/blob/main/rules/instructions/deployment-governance.md).
