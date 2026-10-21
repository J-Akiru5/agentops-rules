# Changelog

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

