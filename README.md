# AgentOps global rules

Portable OpenCode development protocol for the team: waiting/status discipline, branch-aware
worktree orchestration, autonomous engineering, the planning backbone (`agentctl`), Vercel deployment
governance, and multi-machine team coordination.

**OpenCode 2 is the primary target (v1.2.0+).** V1 remains supported for legacy machines, but the
installer detects the binary and migrates a V1 `permission` block to the V2 `permissions` array when
you upgrade. Docs: [OpenCode 2 setup](docs/OPENCODE-2.md) · [Team plan](docs/TEAM-PLAN.md) ·
[Copy-paste prompt](PROMPT.md).

OpenCode does **not** sync global instructions through an account. This package installs them on each
machine from Git, non-destructively.

## Requirements

- Node.js **22.5+** (uses `node:sqlite`; tested on Node 24)
- Git
- OpenCode **V1 or V2** (the installer detects the version; `--opencode v1|v2` overrides)
- Windows (PowerShell or cmd) or macOS/Linux

## Install (each laptop)

```powershell
git clone https://github.com/J-Akiru5/agentops-rules.git
cd agentops-rules
node install.mjs
```

Then **restart OpenCode** and start a fresh session. Confirm:

- Ask: “What is your waiting/status protocol?”
- Ask: “Which branches may trigger Vercel deployments?”
- Run: `node ~/.config/opencode/bin/agentctl.mjs help`

If your config uses `opencode.json` instead of `opencode.jsonc`, the installer detects and updates it.
`--target <dir>` installs into a custom OpenCode config directory (useful for testing).

### Download instead of Git

Download `agentops-rules.zip` from
[Releases](https://github.com/J-Akiru5/agentops-rules/releases/latest), extract it, then run:

```powershell
node install.mjs
```

The repository is private; sign in to GitHub to download, or use `gh release download` as shown in
`PROMPT.md`.

### OpenCode V1 vs V2 (important)

The installer runs `opencode --version` and writes the matching config format:

- **V2 (primary)** → ordered `permissions` array. If a V1 `permission` object exists, it is converted
  into V2 rules and removed (backup kept).
- **V1 (legacy)** → `permission.bash` + `permission.shell` objects (V1 has used both tool names). Any
  V2 `permissions` array is removed, so the error “V2 permissions are not supported by OpenCode V1”
  disappears.

Override detection when needed:

```powershell
node install.mjs --opencode v2   # opencode 2.x (recommended)
node install.mjs --opencode v1   # legacy opencode 1.x
```

The config format must match the binary you actually run. If `opencode` is V1 and `opencode2` is V2,
pick one consistently: for V2 run `node install.mjs --opencode v2` and use `opencode2`. To replace the
V1 `opencode` shim with V2:

```powershell
Remove-Item "$env:APPDATA\npm\opencode.ps1" -Force
npm install -g @opencode/cli
node install.mjs --opencode v2
```

Instruction entries are written as **absolute paths** in either mode, so V1 and V2 resolve the same
files deterministically.

See [`docs/OPENCODE-2.md`](docs/OPENCODE-2.md) for the full OpenCode 2 upgrade and verification
guide.

### Copy-paste prompt

See [`PROMPT.md`](PROMPT.md) for a prompt you can paste into OpenCode on the other machine. It
downloads the release, runs the installer, reports the result, and verifies the rules.

## What the installer changes

| Target | Change |
| --- | --- |
| `~/.config/opencode/AGENTS.md` | Adds/updates a managed block. Your existing content is preserved. |
| `~/.config/opencode/instructions/*.md` | Installs/updates the four shared rule files. |
| `~/.config/opencode/bin/agentctl.mjs` + `bin/agentops/` | Installs the AgentOps CLI and modules. |
| `~/.config/opencode/bin/orchestrator.mjs` | Installs the resource/worktree helper. |
| `~/.config/opencode/opencode.jsonc` | Adds the managed instruction entries and safe permission rules. Existing keys, instructions and permissions are preserved. |

- Every modified file is backed up to `~/.config/opencode/.agentops/backups/<timestamp>/` first.
- Re-running is idempotent; managed entries are added once.
- The installer rewrites `opencode.jsonc` as plain JSON (comments are lost in the live file, but the
  original is in the backup). If you prefer to keep comments, merge manually from the backup instead.
- No network calls, no secrets, no deployment side effects.

Options: `--dry-run`, `--no-backup`, `--target <dir>`, `--run-tests` (runs the full reliability suite;
takes several minutes), `--help`.

## Update

```powershell
cd agentops-rules
git pull
node install.mjs
```

## Team model (important)

- Rules are identical on every machine; **runtime state is not**.
  `<git-common-dir>/agentops/state.db` is local to each clone. Claims/leases do not coordinate across
  machines, and must not be placed on a network share or sync folder.
- Designate one **integrator machine**. Only it runs `agentctl integrate` and pushes `origin/develop`.
  Other machines implement, verify and push task branches.
- Only the human promotes `main`. No agent pushes `main` or `staging`.
- Use a unique `AGENT_ID` per machine when running `agentctl` (for example `opencode-loq`,
  `opencode-laptop2`).
- Before pushing a feature branch, confirm the repository's Vercel allowlist is active on `main`;
  otherwise preview deployments can still be created and consume the daily allowance.
- Cross-machine atomic claims require a shared state service, which this package does not provide.
  Coordinate by task assignment in the plan/PR and branch ownership.

## Included rules

- `rules/AGENTS.md` — waiting/status protocol, branch-aware worktree orchestration, Vercel deployment
  governance.
- `rules/instructions/autonomous-orchestration.md` — autonomy tiers, resource-aware scheduling,
  coordination, honesty rules.
- `rules/instructions/agentops-backbone.md` — `agentctl` workflow, task contracts, evidence, integration,
  database and reporting.
- `rules/instructions/deployment-governance.md` — deployment allowlist, agent prohibitions, first-
  instantiation checklist.
- `rules/instructions/team-development.md` — multi-machine roles, handoffs, state limitations.
- `rules/instructions/subagent-orchestration.md` — delegation, benchmark standard, resource-pressure behavior.
- `rules/agents/benchmark.md` — read-only global `benchmark` subagent.
- `bin/agentctl.mjs` + `bin/agentops/*` — deterministic planning/verification/integration CLI.
- `bin/orchestrator.mjs` — resource and worktree inventory helper.

## Subagents and benchmarking

Subagents are for independent, parallelizable work: exploration, review, docs, log triage and
measurement. The parent verifies their output; subagent prose is not evidence.

A global **`benchmark`** subagent is installed for performance/resource-sensitive work (latency,
memory, bundle size, build/test duration, query plans, regressions). It is read-only, cannot push or
deploy, and reports baseline/candidate, workload, metric, repetitions and spread. Use it whenever
acceptance criteria depend on measured behavior; an implementer cannot self-certify its own benchmark.

See [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md) for the dispatch contract and examples.

Under resource pressure, a red level is **not a stop order**: continue with light work, dispatch light
subagents, or pick another eligible task; defer heavy checks and retry later.

## Uninstall / rollback

Restore the files from the newest backup directory:

```powershell
Get-ChildItem ~/.config/opencode/.agentops/backups | Sort-Object Name | Select-Object -Last 1
```

Copy the backed-up files back over the installed ones. Remove the managed block (between
`<!-- BEGIN agentops-global (managed) -->` and `<!-- END agentops-global (managed) -->`) from
`AGENTS.md`. Remove the managed `instructions` entries and permission rules if desired.

## Using with the Lagavista repository

```powershell
git clone https://github.com/J-Akiru5/lagavista.git
cd lagavista
agentctl plan sync
agentctl status
```

The project’s `AGENTS.md`, `plan/` contracts and policy travel with the repository. The global rules
installed by this package supply the workflow; `agentctl` is installed at
`~/.config/opencode/bin/agentctl.mjs`.

Set a per-machine identity for local state and evidence:

```powershell
$env:AGENT_ID = "opencode-laptop2"   # add to your PowerShell profile
```

Designate one integrator machine (normally the primary machine) to run `agentctl integrate` and push
`origin/develop`. The other machine pushes task branches and does not integrate.

## Develop this package

```powershell
node --test install.test.mjs
node install.mjs --target .\tmp-test
```

Version: see `VERSION`. Changes: see `CHANGELOG.md`.
