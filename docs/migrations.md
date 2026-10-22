# Migrations

## Version history

| Version | Highlights | Migration action |
| --- | --- | --- |
| **1.5.0** | Versioning/release rule; public docs site; public repo; release automation | Reinstall; expect **6 instructions** and still 27 permissions. No config shape change. |
| **1.4.0** | Automatic worktree instantiation + isolation enforcement in `claim`; `worktree` policy block | Reinstall. Existing workflows continue; claims now auto-create by default. Set `worktree.auto_create: false` to keep manual management. |
| **1.3.0** | Resource deferral semantics; subagent orchestration standard; global `benchmark` subagent | Reinstall; restart OpenCode so the agent is discovered. |
| **1.2.0** | OpenCode 2 guide; V1→V2 permission migration; absolute instruction paths | Reinstall with `--opencode v2`; the V1 `permission` block is converted and removed. |
| **1.1.0** | OpenCode V1 + V2 support; V1 `permission.bash`/`shell` | Reinstall; V1 config no longer contains the unsupported `permissions` array. |
| **1.0.0** | Initial rules package, AgentOps CLI, worktree/deployment protocols | Initial install. |

## Update

```powershell
git pull
node install.mjs
```

Or download the latest release zip and run `node install.mjs`. Updates are idempotent and back up every
modified file.

## Version 1.5.0 — versioning and public documentation

- Adds `instructions/versioning.md` (sixth managed instruction). Configuration now expects
  **6 instructions**, 27 permissions, and the benchmark agent.
- Adds a public documentation site built with VitePress and GitHub Pages.
- Adds CI, release automation, license and repository templates.
- No breaking change to `agentctl`, policy keys or contract fields. A MINOR release.

Verify:

```powershell
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.config/opencode/opencode.jsonc','utf8'));console.log({instructions:c.instructions.length,permissions:c.permissions.length,v1Block:Object.hasOwn(c,'permission'),benchmark:fs.existsSync(process.env.USERPROFILE+'/.config/opencode/agents/benchmark.md')})"
```

Expected: `{"instructions":6,"permissions":27,"v1Block":false,"benchmark":true}`.

## Version 1.2.0 — OpenCode 2 migration

1. Upgrade the binary; verify `opencode --version` reports 2.x.
2. Run `node install.mjs --opencode v2`.
3. The installer converts a V1 `permission` object into V2 `permissions`, removes the deprecated block,
   writes absolute instruction paths, and backs up the old config.

If you stay on V1, run `node install.mjs --opencode v1`; it writes `permission.bash` and
`permission.shell` and removes the V2 `permissions` array.

## Version 1.4.0 — worktrees

- `claim` auto-creates `<worktree.root>/<repo>-<task>` on `<branch_prefix>/<task>-<slug>`.
- `--worktree` must be registered, non-primary, clean, branch-consistent and unclaimed.
- `--create` / `--no-create` override policy. See [Worktrees](/worktrees).

## Version 1.3.0 — resource deferral and subagents

- Resource refusals are deferrals, not task failures; task state is preserved and the agent continues.
- Adds the subagent standard and read-only `benchmark` subagent.
- See [Subagents](/subagents) and [Architecture](/architecture).

## Version 1.1.0 — V1/V2 compatibility

- V1 installs use `permission.bash` and `permission.shell`; V2 uses the ordered `permissions` array.
- Instruction paths are absolute, so both generations resolve the same files.
