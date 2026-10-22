# AgentOps Rules

[![CI](https://github.com/J-Akiru5/agentops-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/J-Akiru5/agentops-rules/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/J-Akiru5/agentops-rules)](https://github.com/J-Akiru5/agentops-rules/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenCode 2](https://img.shields.io/badge/OpenCode-2.x-000000)](https://opencode.ai/v2)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://j-akiru5.github.io/agentops-rules/)

A portable operating protocol for autonomous coding agents on **OpenCode**. It gives agents a
canonical plan, transactional coordination, evidence-based verification, isolated worktrees,
serialized integration, safe deployments and measurable subagents — installed globally, non-destructively.

```powershell
git clone https://github.com/J-Akiru5/agentops-rules.git
cd agentops-rules
node install.mjs
```

Then restart OpenCode and start a fresh session.

## Why

Autonomous coding fails when completion is prose. This package makes the workflow inspectable:

- **Intent** — versioned Markdown contracts on `develop`, read through Git, never a stale checkout.
- **State** — SQLite in `<git-common-dir>/agentops/state.db`: atomic claims, leases, fencing, evidence,
  locks. Never a concurrently edited Markdown board.
- **Evidence** — tool-produced verification keyed to the exact tree; completion requires integration and
  remote verification, not "it builds".
- **Worktrees** — `agentctl claim` auto-creates an isolated worktree and task branch, refuses the
  primary checkout and dirty/foreign trees, and prints the path to move to.
- **Integration** — a deterministic integrator merges a candidate, verifies it, commits evidence,
  advances `develop` by compare-and-swap, pushes, and verifies the remote.
- **Deployments** — Vercel automatic deployments are allowlisted to `main`/`develop`; agents never
  deploy to test.
- **Subagents** — a dispatch contract plus a read-only `benchmark` subagent for performance claims.
- **Resources** — red/amber levels defer heavy work; they are not stop orders. Agents continue light
  work or another task.

## Compatibility

- OpenCode **V1 and V2** (V2 primary; V1 legacy config path)
- Node.js **≥ 22.5** (`node:sqlite`)
- Windows, Linux; macOS supported
- No external services, no credentials, no deployments during install

The installer detects `opencode --version` and writes the matching config shape. V1 uses
`permission.bash`/`permission.shell`; V2 uses the ordered `permissions` array. A V1 config upgraded to V2
is migrated automatically.

## Documentation

- **Docs site:** https://j-akiru5.github.io/agentops-rules/
- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [CLI reference](docs/cli-reference.md)
- [Policy reference](docs/policy-reference.md)
- [Contract reference](docs/contract-reference.md)
- [Worktrees](docs/worktrees.md)
- [Subagents and benchmarking](docs/subagents.md)
- [Deployment governance](docs/deployment-governance.md)
- [Team plan](docs/team-plan.md)
- [Versioning](docs/versioning.md) · [Releasing](docs/releasing.md)
- [Migrations](docs/migrations.md)
- [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## What gets installed

| Path | Purpose |
| --- | --- |
| `~/.config/opencode/AGENTS.md` | Managed block: waiting/status, worktree, versioning, deployment, resource/subagent rules |
| `~/.config/opencode/instructions/*.md` | Six detailed protocols (autonomy, AgentOps, deployment, team, subagents, versioning) |
| `~/.config/opencode/agents/benchmark.md` | Read-only global benchmark subagent |
| `~/.config/opencode/bin/agentctl.mjs` + `bin/agentops/` | Planning/verification/integration CLI |
| `~/.config/opencode/bin/orchestrator.mjs` | Resource and worktree inventory helper |
| `~/.config/opencode/opencode.jsonc` | Instructions + ordered permission rules (merged, not replaced) |

Every modified file is backed up under `~/.config/opencode/.agentops/backups/<timestamp>/`. Re-running
the installer is idempotent.

## Install options

Download `agentops-rules.zip` from [Releases](https://github.com/J-Akiru5/agentops-rules/releases) and run
`node install.mjs`, or clone as above. Useful flags:

```text
--target <dir>          install into a custom OpenCode config directory
--opencode auto|v1|v2   override binary detection
--dry-run               show what would change
--no-backup             skip backups (not recommended)
--run-tests             run the full reliability suite after install
```

`PROMPT.md` contains copy-paste prompts for another machine.

## Versioning and releases

The project follows [Semantic Versioning](docs/versioning.md). Agents prepare releases (changelog,
version files, tests, notes, artifact); **the owner creates and pushes the `vX.Y.Z` tag**, and the
release workflow publishes the GitHub Release with a zip and SHA256 checksum.

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Release checklist: [docs/releasing.md](docs/releasing.md)
- Immutable tags/releases; fix forward with a PATCH.

## Development

```powershell
node --test install.test.mjs      # installer
node --test bin/orchestrator.test.mjs
node --test bin/agentctl.test.mjs # full AgentOps suite
npm ci
npm run docs:build                # VitePress site
```

CI runs the installer, orchestrator and full AgentOps suite on Windows/Ubuntu with Node 22/24, plus a
docs build.

## Security

The package installs local files and a CLI. It contains no credentials and makes no network calls during
installation. Runtime state stays on the local disk; never put `.git/agentops/state.db` on a network or
sync folder. Report vulnerabilities privately via GitHub Security Advisories — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Jeff Akiru (J-Akiru5).
