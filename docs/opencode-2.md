# OpenCode 2 — setup and migration

Applies to `agentops-rules` **v1.2.0+**.

OpenCode 2 is the primary target. The installer also supports V1 for legacy machines, but V2 is the
supported team configuration going forward.

## What changed in OpenCode 2

| Concern | V1 | V2 |
| --- | --- | --- |
| Permission config | `permission` object (deprecated in V2) | `permissions` ordered array of `{ action, resource, effect }` |
| Shell tool key | `shell` (some V1 builds used `bash`) | action `shell` |
| Rule ordering | last matching pattern wins | ordered array; later rules win |
| Instructions | `instructions` array | `instructions` array |
| Global rules | `~/.config/opencode/AGENTS.md` | same path |

The classic V1 error:

```text
Configuration is invalid at .../opencode.jsonc
V2 permissions are not supported by OpenCode V1. Use V1 "permission" rules or run opencode2.
```

means the config was written for V2 while the binary was V1. v1.2.0 prevents this by detecting the
installed version; when migrating V1 → V2 it also converts the deprecated `permission` object into
`permissions` and removes it.

## Upgrade checklist (V1 → V2)

1. Upgrade the binary and verify:
   ```powershell
   opencode --version
   # must report 2.x
   ```
2. Update the rules package:
   ```powershell
   cd agentops-rules
   git pull
   node install.mjs --opencode v2
   ```
3. The installer:
   - converts any V1 `permission` rules into V2 `permissions` entries;
   - removes the deprecated `permission` block;
   - ensures the 27 managed permission rules are present;
   - rewrites instruction entries to absolute paths;
   - backs up every modified file under `~/.config/opencode/.agentops/backups/<timestamp>/`.
4. Restart OpenCode and verify in a fresh session.

## Fresh install (OpenCode 2)

```powershell
# From the release zip
node install.mjs

# Or from Git
git clone https://github.com/J-Akiru5/agentops-rules.git
cd agentops-rules
node install.mjs
```

Auto-detection runs `opencode --version`. Use `--opencode v2` when detection is ambiguous (for
example, when both `opencode` and `opencode2` exist).

## Verify the installed config

```powershell
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.config/opencode/opencode.jsonc','utf8'));console.log({permissions:Array.isArray(c.permissions),v1Block:Object.hasOwn(c,'permission'),instructions:c.instructions.length,permissionRules:c.permissions?.length})"
```

Expected:

```json
{ "permissions": true, "v1Block": false, "instructions": 6, "permissionRules": 27 }
```

The config should contain an absolute `instructions` entry for each of:

- `instructions/autonomous-orchestration.md`
- `instructions/agentops-backbone.md`
- `instructions/deployment-governance.md`
- `instructions/team-development.md`
- `instructions/subagent-orchestration.md`
- `instructions/versioning.md`

The installer also places the read-only `benchmark` subagent at
`~/.config/opencode/agents/benchmark.md`.

## V2 config shape (excerpt)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "C:/Users/<you>/.config/opencode/instructions/autonomous-orchestration.md",
    "C:/Users/<you>/.config/opencode/instructions/agentops-backbone.md",
    "C:/Users/<you>/.config/opencode/instructions/deployment-governance.md",
    "C:/Users/<you>/.config/opencode/instructions/team-development.md",
    "C:/Users/<you>/.config/opencode/instructions/subagent-orchestration.md",
    "C:/Users/<you>/.config/opencode/instructions/versioning.md"
  ],
  "permissions": [
    { "action": "shell", "resource": "git push --force*", "effect": "ask" },
    { "action": "shell", "resource": "vercel deploy*", "effect": "ask" }
    // ... 25 more managed rules
  ]
}
```

Do not add a V1 `permission` block back. If an older config still has one, rerun the installer with
`--opencode v2`; it migrates the rules and removes the block.

## Verify the rules load in a session

Start a fresh OpenCode 2 session and ask:

- “What is your waiting/status protocol?”
- “Which branches may trigger Vercel deployments?”
- “Where does AgentOps state live, and why is it not shared across machines?”

Then run:

```powershell
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" help
```

## Troubleshooting

### The V1 error still appears

You are running a V1 binary with a V2 config. Either:

- upgrade and run OpenCode 2, then `node install.mjs --opencode v2`; or
- stay on V1 and run `node install.mjs --opencode v1` (writes `permission.bash`/`permission.shell`
  and removes `permissions`).

The config format must match the binary you actually launch. Do not mix them.

### `npm install -g @opencode/cli` fails with EEXIST

An old V1 shim is in the way. If you want V2 as `opencode`:

```powershell
Remove-Item "$env:APPDATA\npm\opencode.ps1" -Force
npm install -g @opencode/cli
node install.mjs --opencode v2
```

If `opencode2` already exists and reports 2.x, you can keep it and run
`node install.mjs --opencode v2`, using `opencode2` consistently.

### Release download notes

The rules repo is public. Download a release, use `gh release download`, or clone with Git. GitHub
authentication is only needed for rate limits or private forks.

### The config was reformatted and lost comments

That is expected: the installer writes plain JSON and keeps the original under
`.agentops/backups/<timestamp>/`. Restore from there if you need the commented version.

## Related documents

- [`team-plan.md`](team-plan.md) — rollout and operating plan for both laptops.
- [`subagents.md`](subagents.md) — delegation and the benchmark subagent standard.
- [`worktrees.md`](worktrees.md) — automatic worktree instantiation, isolation and cleanup.
- [`PROMPT.md`](https://github.com/J-Akiru5/agentops-rules/blob/main/PROMPT.md) - copy-paste install/verification prompt.
- [`README.md`](https://github.com/J-Akiru5/agentops-rules/blob/main/README.md) - package overview and options.
