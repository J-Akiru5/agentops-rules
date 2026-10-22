# Contributing

## Development

```powershell
git clone https://github.com/J-Akiru5/agentops-rules.git
cd agentops-rules
node --test install.test.mjs
node --test bin/orchestrator.test.mjs
node --test bin/agentctl.test.mjs
```

The CLI and installer use Node built-ins only. The documentation site uses VitePress:

```powershell
npm ci
npm run docs:dev
npm run docs:build
```

## Pull requests

- Keep changes scoped; explain the behavior change and the verification performed.
- Add or update tests for installer/CLI behavior.
- Update docs and `CHANGELOG.md` under `Unreleased`.
- Run the full AgentOps suite; CI runs it on Windows/Ubuntu with Node 22/24.
- Do not create or push release tags, publish releases, or change repository visibility. Those are
  owner actions under [Versioning](/versioning).
- Do not include secrets, private project data or internal URLs in fixtures/docs.
- By contributing, you agree your work is licensed under the repository's MIT license.

## Commit style

Prefer conventional, descriptive commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Keep unrelated
changes out of a commit. The release changelog is written for users, not a raw commit log.

## Documentation

- Use the docs site structure under `docs/`.
- Update links and `docs/.vitepress/config.mts` when adding a page.
- Keep the public docs generic; project-specific adapters belong in that project's repository.
