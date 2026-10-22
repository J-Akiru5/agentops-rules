# Contributing

Thanks for improving AgentOps Rules.

## Quick start

```powershell
git clone https://github.com/J-Akiru5/agentops-rules.git
cd agentops-rules
node --test install.test.mjs
node --test bin/orchestrator.test.mjs
node --test bin/agentctl.test.mjs
npm ci
npm run docs:build
```

The CLI and installer use Node built-ins only. VitePress is a development dependency for the docs site.

## Pull requests

- Keep changes scoped and explain the behavior change and verification.
- Add/update tests for installer or CLI behavior.
- Update `CHANGELOG.md` under `Unreleased`.
- Update docs and `docs/.vitepress/config.mts` when adding a page.
- Run the full suite; CI runs it on Windows/Ubuntu with Node 22/24.
- Do not create/push release tags, publish releases, or change repository visibility. Those are owner
  actions under [Versioning](docs/versioning.md).
- Do not include secrets, private project data, internal URLs or credentials in fixtures/docs.
- By contributing, you agree your work is licensed under the repository's MIT license.

## Commit style

Prefer descriptive conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). The changelog is
written for users, not copied from commit messages.

## Documentation

- Public docs live under `docs/`.
- Keep examples generic; project-specific adapters belong in the project repository.
- Release notes are generated from `CHANGELOG.md`, not written separately.
