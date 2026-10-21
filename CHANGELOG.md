# Changelog

## 1.2.0 — 2026-10-21

- **OpenCode 2 documentation and migration**: `docs/OPENCODE-2.md` covers fresh install, V1 → V2
  upgrade, config verification and troubleshooting.
- Installer **migrates V1 `permission` to V2 `permissions`** (including `bash`/`shell` maps) and
  removes the deprecated block; V1 installs write both `permission.bash` and `permission.shell`.
- **Team plan**: `docs/TEAM-PLAN.md` — rollout phases, roles, pilot task, deployment prerequisite,
  acceptance checklist and risks.
- `PROMPT.md` updated for v1.2.0 and OpenCode 2, with a config sanity command.
- Installer tests cover V1, V2, V1→V2 migration, idempotency, dry-run and refusal (7 tests).

## 1.1.0 — 2026-10-21

- **OpenCode V1 + V2 support**: installer detects `opencode --version` (override with
  `--opencode v1|v2`).
- V1 writes `permission.shell` rules and removes the V2 `permissions` array that made V1 report
  “Configuration is invalid … V2 permissions are not supported by OpenCode V1”.
- Instruction entries use absolute paths so both versions resolve them deterministically; legacy
  `~/.config/...` managed entries are migrated.
- Downloadable release (`agentops-rules.zip`) and `PROMPT.md` with a copy-paste install prompt.
- Installer tests cover V1, V2, migration, idempotency and dry-run (7 tests).

## 1.0.0 — 2026-10-21

- Initial portable global rules package.
- Includes waiting/status protocol, branch-aware worktree orchestration, autonomous engineering
  protocol, AgentOps planning backbone, Vercel deployment governance and multi-machine team rules.
- Includes `agentctl` and `orchestrator` helpers with tests.
- Non-destructive installer with backups, managed `AGENTS.md` block, config merge, dry-run and
  idempotent re-runs.

