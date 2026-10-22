# Releasing

The release workflow is tag-driven. **A human creates and pushes the tag**; the workflow validates the
release, runs the gates, builds the artifact and publishes the GitHub Release.

## Prerequisites

- `main` contains the release preparation and CI is green.
- `package.json` and `VERSION` carry the new version.
- `CHANGELOG.md` has the version section.
- The release check passes:

```powershell
node scripts/release-check.mjs --tag vX.Y.Z
```

## Human release steps

```powershell
git switch main
git pull
node scripts/release-check.mjs --tag vX.Y.Z

git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The `Release` workflow then:

1. re-runs the release check and all tests;
2. builds `agentops-rules.zip` from the tagged commit;
3. writes `agentops-rules.zip.sha256`;
4. extracts release notes from `CHANGELOG.md`;
5. creates the GitHub Release with both assets.

Do not create the release manually, re-tag, or replace a published asset.

## Verify the release

```powershell
gh release view vX.Y.Z --repo J-Akiru5/agentops-rules
gh release download vX.Y.Z --repo J-Akiru5/agentops-rules --pattern "agentops-rules.zip*"
Get-FileHash .\agentops-rules.zip -Algorithm SHA256
# compare with agentops-rules.zip.sha256
```

Install it into a clean target and confirm the version/instructions:

```powershell
node install.mjs --target "$env:TEMP\agentops-release-check"
```

## Release v1.5.0

The v1.5.0 changes add the versioning rule, public docs site, CI and repository polish. After CI is
green on `main`:

```powershell
node scripts/release-check.mjs --tag v1.5.0
git tag -a v1.5.0 -m "v1.5.0 — versioning rule and public documentation"
git push origin v1.5.0
```

## If a release is wrong

Do not delete or edit the tag/asset. Publish a corrected PATCH with a changelog note explaining the
issue and the fix. Preserve the original artifact for audit.
