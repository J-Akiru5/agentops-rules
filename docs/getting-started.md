# Getting started

## Requirements

- **Node.js ≥ 22.5** (the CLI uses `node:sqlite`; tested on Node 24)
- **Git**
- **OpenCode V1 or V2** (V2 is primary; the installer detects the binary)
- Windows, Linux, or macOS

## Install

### From a release (no Git)

Download the latest `agentops-rules.zip` from
[Releases](https://github.com/J-Akiru5/agentops-rules/releases/latest), extract it, then:

```powershell
node install.mjs
```

### From Git

```powershell
git clone https://github.com/J-Akiru5/agentops-rules.git
cd agentops-rules
node install.mjs
```

The installer prints the OpenCode generation it detected. Override with `--opencode v1` or
`--opencode v2` when detection is ambiguous.

## What the installer does

- Adds a managed block to `~/.config/opencode/AGENTS.md` (existing content preserved).
- Installs six instruction files under `~/.config/opencode/instructions/`.
- Installs `agentctl`, its modules, and `orchestrator` under `~/.config/opencode/bin/`.
- Installs the read-only `benchmark` subagent under `~/.config/opencode/agents/`.
- Merges six instruction entries and 27 ordered permission rules into `opencode.jsonc`.
- Backs up every modified file under `~/.config/opencode/.agentops/backups/<timestamp>/`.

It is idempotent: run it again after updating the package.

## Verify

Restart OpenCode and start a fresh session. Ask:

- “What is your waiting/status protocol?”
- “Which branches may trigger Vercel deployments?”
- “Can you apply a development migration or deploy `develop` without asking? What about `main`?”
- “Where does AgentOps state live, and why is it not shared across machines?”

Then run:

```powershell
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" help
```

Expected config:

```json
{
  "instructions": 6,
  "permissions": 27,
  "v1Block": false,
  "benchmarkAgent": true
}
```

## Update

```powershell
cd agentops-rules
git pull
node install.mjs
```

Or download the new release and run `node install.mjs`.

## Uninstall

Restore the newest backup:

```powershell
Get-ChildItem ~/.config/opencode/.agentops/backups | Sort-Object Name | Select-Object -Last 1
```

Copy the backed-up files over the installed ones, remove the managed block between
`<!-- BEGIN agentops-global (managed) -->` and `<!-- END agentops-global (managed) -->`, and remove the
managed instruction/permission entries if desired.

## Modes

- **V2 (primary):** `permissions` ordered array; `agentctl` works normally.
- **V1 (legacy):** `permission.bash`/`permission.shell`; the installer removes an unsupported V2
  `permissions` array. See [OpenCode 2](/opencode-2) for migrating V1 → V2.

## Next steps

1. Read [Architecture](/architecture) to understand intent/state/evidence.
2. Read [Worktrees](/worktrees) before claiming your first task.
3. Read [Policy](/policy-reference) and [Task contracts](/contract-reference) before authoring work.
4. For a team, follow [Team plan](/team-plan) and [Subagents](/subagents).
5. For releases, follow [Versioning](/versioning) and [Releasing](/releasing).
