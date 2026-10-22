# Security

## Supported versions

Security fixes are provided for the latest `1.x` release. Older releases may be asked to upgrade before
a fix is backported.

## Reporting a vulnerability

Do **not** open a public issue for a vulnerability. Use **GitHub Security Advisories** on this repository
(“Security” → “Report a vulnerability”) or contact the maintainer privately. Include:

- affected version/tag,
- reproduction steps,
- impact and required access,
- any suggested mitigation.

You will get an acknowledgment and a coordinated disclosure plan. Do not publish exploit details before
a fix is available.

## What this package installs

- Markdown instructions and agent definitions under `~/.config/opencode/`.
- Node scripts (`agentctl`, `orchestrator`) under `~/.config/opencode/bin/`.
- A merged `opencode.jsonc` with instruction entries and permission rules.
- Backups under `~/.config/opencode/.agentops/backups/`.

The installer performs no network calls and stores no credentials. It only writes to the selected
OpenCode config directory.

## Secrets and data

- Never commit credentials, tokens, connection strings or `.env` files.
- AgentOps state (`<git-common-dir>/agentops/state.db`) and logs stay local. Do not put them on a network
  share, OneDrive, or any synced folder.
- Database commands read `SUPABASE_DB_URL` from the repository's env file, verify the development project
  and never print the connection string. Production credentials and data are out of scope.
- Deployment commands and Vercel tokens are not part of the package. Agents must not deploy to test the
  protocol.

## Permissions

The installed `permissions` rules ask before force-push, history rewriting, destructive shell, deployment
and database-reset operations. These are safeguards, not a sandbox. Review the rules in your
`opencode.jsonc` and adapt them to your machine. The last matching rule wins.

## Supply chain

- The CLI uses Node built-ins only; no runtime dependencies.
- The documentation site uses VitePress as a development dependency, installed in CI; it is not required
  at runtime or by the installer.
- Release artifacts are generated from the tagged commit and published with a SHA256 checksum.
- Verify the checksum before installing a downloaded artifact:

```powershell
Get-FileHash .\agentops-rules.zip -Algorithm SHA256
```

## Public repository

The source, instructions, docs and tests are public. Do not add private project data, internal URLs or
credentials to examples, tests or docs. Team-specific adapters belong in the project repository, not in
this package.
