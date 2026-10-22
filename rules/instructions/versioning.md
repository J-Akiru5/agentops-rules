# Versioning and releases

This rule governs version numbers, changelogs, tags, release artifacts and publication for the
rules package, project packages, tools and documentation. It applies on every machine and every
repository that uses this protocol.

## Semantic Versioning

Use **Semantic Versioning 2.0.0**: `MAJOR.MINOR.PATCH`. Tags are annotated `vX.Y.Z`. A published tag
and its release artifacts are immutable.

| Bump | Rules package / tooling | Project packages |
| --- | --- | --- |
| **MAJOR** | Managed file names/paths, installer or config shape, permission semantics, CLI flags or exit codes, state schema, required contract/policy fields, supported OpenCode/Node/OS dropped | Breaking API, schema or behavior; removed features; dropped platform support |
| **MINOR** | New instruction, agent, command or profile; additive policy/contract field; compatible default change; new docs/site | New backward-compatible features; deprecations with warnings |
| **PATCH** | Typo, broken link, comment, non-behavioral docs, internal fix | Bug or security fix without contract change |

- Do not bump for every commit. Release at meaningful milestones; batch compatible fixes.
- A large or risky change may ship as `vX.Y.Z-rc.N` first. Pre-releases are not installed on team
  machines by default.
- A breaking change requires a migration guide, changelog entry and updated reference docs.

## Contract revisions are not versions

`plan/tasks/*.md` carries an integer `rev`. It is an amendment revision, not semver. It increments
only through the amendment workflow. Do not use semver in contracts; do not bump contract `rev` for a
package release.

## Sources of truth

For a release, all of these MUST agree:

1. `package.json.version`
2. the `VERSION` file (installer package)
3. the Git tag (`vX.Y.Z`)
4. the release title
5. the `CHANGELOG.md` section for that version

Run `node scripts/release-check.mjs --tag vX.Y.Z` before tagging. CI and the release workflow run the
same check. A mismatch fails the release.

## Changelog

Use **Keep a Changelog** with an `Unreleased` section and these categories:

`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

- Every behavior change gets an entry under `Unreleased` in the same work that changes it.
- The release notes are generated from the changelog section, not hand-written separately.
- Link migrations and breaking changes from the entry.

## Release process

1. Confirm the scope and that all task/contract acceptance criteria are satisfied.
2. Run the full gates: installer tests, orchestrator tests, AgentOps suite, docs build and any
   project-specific checks. No release from a dirty or unverified tree.
3. Choose the SemVer bump using the table above; update `package.json` and `VERSION`.
4. Move `Unreleased` entries into the new version section in `CHANGELOG.md`; add migration notes for
   MAJOR/MINOR behavior changes.
5. Commit the release preparation on the integration branch; open a release PR when the repository
   requires one.
6. After CI is green, a human creates and pushes the annotated tag:
   `git tag -a vX.Y.Z -m "vX.Y.Z"` and `git push origin vX.Y.Z`.
7. The release workflow validates tag/version/changelog, runs tests, builds the artifact (zip) and
   SHA256 checksum, and publishes the GitHub Release.
8. Install the published artifact into a clean target and verify it; report the version and checksum.

Never publish from an unverified commit, a dirty tree, or a non-release branch.

## Authority

**Agents prepare; humans publish.**

- Agents may add `Unreleased` entries, choose a proposed bump, update version files, run gates, build
  a local artifact and open a release PR.
- Agents MUST NOT create/push release tags or publish GitHub Releases/npm packages unless the owner
  explicitly delegates one named release and records that authorization.
- MAJOR bumps, visibility/license changes, npm publication and moving a release channel always
  require the owner.
- A human reviews the release diff and CI before tagging.
- Tags and release assets are never moved, deleted or replaced. Fix forward with a new PATCH.

## Publication channels

- **GitHub Releases** are the canonical channel for this package: source archive, `agentops-rules.zip`
  and `.sha256`.
- **npm** is not a current channel. Publishing to npm requires a separate owner decision, a public
  package name, license/engines/files metadata, provenance and a MINOR release.
- Documentation is published to GitHub Pages from `main`; it describes the current release and links
  to release notes. Older behavior is available through Git tags.
- A release is separate from deployment. Do not trigger a Vercel deployment to validate a release.
  An instruction to deploy `main` is not authorization to create/push a release tag or publish a
  GitHub Release; those remain separate owner decisions.

## Compatibility

Declare and test the supported matrix in the README and release notes:

- OpenCode **V1 and V2** (V2 primary; V1 legacy installer path)
- Node.js **≥ 22.5** (uses `node:sqlite`)
- Windows and Linux (macOS supported but not CI-gated unless added)

Dropping support for a platform/version is a MAJOR change.

## Deprecation

- Announce deprecation in a MINOR release with warnings and a migration path.
- Keep the old behavior for at least one MINOR cycle.
- Remove it only in the next MAJOR.
- Document each deprecation and removal in the changelog.

## Rollback and security

- Do not delete or retag a published release. Publish a new PATCH that fixes forward.
- Security fixes are PATCH releases unless they require a breaking change. Coordinate disclosure
  privately; never put secrets, tokens or vulnerable exploit details in public release notes.
- If a release artifact is wrong, mark the release notes and publish a corrected PATCH; preserve the
  original artifact for audit.

## Documentation and versioning

- README badges, docs home and installer output show the current version.
- Release notes include migration/compatibility notes.
- Docs describe the current release; use Git tags for historical versions.
- `scripts/release-check.mjs` is the executable version policy; run it before every tag.

## Honesty

Report the version, tag, commit, artifact checksum and verification result. Never claim a release,
tag, publication or compatibility result that was not produced by tooling.
