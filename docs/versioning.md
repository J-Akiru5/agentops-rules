# Versioning

This page summarizes the versioning rule. The authoritative instruction is
[`rules/instructions/versioning.md`](https://github.com/J-Akiru5/agentops-rules/blob/main/rules/instructions/versioning.md)
and is installed globally by the package.

## Semantic Versioning

`MAJOR.MINOR.PATCH`, annotated `vX.Y.Z` tags, immutable releases.

| Bump | Rules package / tooling | Project packages |
| --- | --- | --- |
| **MAJOR** | Managed paths/names, installer/config shape, permission semantics, CLI flags/exit codes, state schema, required contract/policy fields, dropped OpenCode/Node/OS | Breaking API/schema/behavior; removed features; dropped platforms |
| **MINOR** | New instruction/agent/command/profile, additive field, compatible default change, new docs/site | New backward-compatible features; warnings for deprecations |
| **PATCH** | Typo/link/comment/docs fix, internal fix | Bug/security fix without contract change |

Contract `rev` is an amendment revision, not semver.

## Sources of truth

`package.json.version` = `VERSION` = Git tag = release title = changelog section. A mismatch fails the
release gate:

```powershell
node scripts/release-check.mjs --tag vX.Y.Z
```

## Changelog

Keep a Changelog with `Unreleased`, then `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
Every behavior change gets an entry in the same work that changes it.

## Authority

**Agents prepare; humans publish.**

- Agents: changelog entry, proposed bump, version files, tests, dry-run artifact, release PR/notes.
- Owner/lead: review, annotated tag, push tag, publish release. One named release may be delegated in
  writing.
- MAJOR, visibility/license changes and npm publication always require the owner.
- No tags or releases from a dirty/unverified tree. Never move, delete or replace a published tag or
  asset; fix forward with a PATCH.

## Release checklist

1. All task acceptance criteria and gates pass.
2. Choose MAJOR/MINOR/PATCH; update `package.json` and `VERSION`.
3. Move `Unreleased` to the new section; add migration/compatibility notes.
4. Run `node scripts/release-check.mjs --tag vX.Y.Z`.
5. Commit/merge on `main`; CI green.
6. Owner creates/pushes the annotated tag.
7. The release workflow builds the zip + SHA256 and publishes the GitHub Release.
8. Install the released artifact in a clean target; verify the version and checksum.
9. Update team machines deliberately.

## Publication

GitHub Releases are canonical. npm is not a current channel; publishing there requires a separate owner
decision and a MINOR release. A release is not a deployment.

## Deprecation

Deprecate in a MINOR with warnings and a migration path; remove in the next MAJOR. Document both in the
changelog.
