# Security policy

## Supported versions

Security fixes are provided for the latest `1.x` release. Older versions may need to upgrade before a
fix is backported.

## Reporting a vulnerability

Do **not** open a public issue for a vulnerability. Use **GitHub Security Advisories**:
**Security** → **Report a vulnerability** in this repository.

Include:

- affected version/tag,
- reproduction steps,
- impact and required access,
- suggested mitigation.

You will receive an acknowledgment and a coordinated disclosure plan. Do not publish exploit details
before a fix is available.

## Scope

This repository contains Markdown instructions, a Node installer/CLI, tests and documentation. It
contains no credentials and performs no network calls during installation. The CLI reads repository
files and a local SQLite database.

Out of scope: vulnerabilities in OpenCode, Git, Node.js, Vercel or Supabase themselves; project
repositories using these rules; misconfiguration of a user's own permissions.

## Safe usage

- Never commit credentials, tokens, connection strings or `.env` files.
- Keep `.git/agentops/state.db` and logs on a local disk, not a network or sync folder.
- Database commands must target the configured development project only.
- Agents must not deploy to test the rules.
- Review the installed `permissions` rules for your environment.
