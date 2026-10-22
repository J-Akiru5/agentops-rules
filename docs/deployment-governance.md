# Deployment governance

Automatic Vercel deployments are a limited resource. This protocol uses a strict branch allowlist and
separates deployment eligibility from permission to push.

## Allowlist

Eligible for automatic deployments:

- `main` — production; human promotion only.
- `develop` — integration branch; pushed by the designated integrator.

Every other branch is ineligible, including `staging`, feature/agent/temporary/experiment branches,
Dependabot branches, unknown branches and pull-request previews from them.

## Agent rules

- Do not run `vercel deploy`, `vercel --prod`, `vercel promote`, `vercel redeploy`, `vercel rollback`,
  create deploy hooks, or call deployment APIs without explicit authorization.
- Do not deploy to test a change. Validate configuration statically.
- `vercel build` is a local build and is allowed; heavy builds follow resource admission.
- Do not add a second deployment pathway for the same integration.
- Deployment eligibility is not push permission: `main` is human-only.

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

Vercel matches with minimatch; `*: false` makes unknown branches ineligible. Explicit `true` entries
allow main/develop. Pull-request previews inherit the branch rule.

Do **not** use the Ignored Build Step as a quota substitute: Vercel documents that canceled builds still
count toward deployment and concurrent build limits. `deploymentEnabled` prevents deployment creation
before a build starts.

## First-instantiation checklist

- [ ] Discover the repository, branch model and integration branch.
- [ ] Discover the linked Vercel project, if any.
- [ ] Identify the production branch.
- [ ] Inspect Git deployment settings and preview behavior.
- [ ] Inspect CI workflows, package scripts, hooks, deployment APIs and webhooks.
- [ ] Configure/verify the main + develop allowlist in each app's `vercel.json`.
- [ ] Verify `staging` is excluded (no branch, no custom environment, no config).
- [ ] Verify feature/temporary branches cannot deploy through automatic pathways.
- [ ] Identify duplicate deployment pathways.
- [ ] Record platform limitations and remaining dashboard actions.
- [ ] Add project-specific notes only where the global rule cannot express the configuration.

## Limits

- CLI/API deploys and deploy hooks are outside `vercel.json`; they are controlled by permissions and
  policy, not platform configuration.
- Vercel may read `git.deploymentEnabled` from the production branch. If the config is only on another
  branch, promotion to `main` may be required before every branch is blocked.
- Never create a deployment to prove the policy; inspect configuration and history instead.

Source: [`rules/instructions/deployment-governance.md`](https://github.com/J-Akiru5/agentops-rules/blob/main/rules/instructions/deployment-governance.md).
