## Summary

<!-- What changed and why? Link the task/issue if applicable. -->

## Verification

- [ ] `node --test install.test.mjs`
- [ ] `node --test bin/orchestrator.test.mjs`
- [ ] `node --test bin/agentctl.test.mjs`
- [ ] `npm run docs:build` (if docs changed)

## Checklist

- [ ] Changelog updated under `Unreleased`
- [ ] Docs updated (and VitePress sidebar if a page was added)
- [ ] No secrets, private data or internal URLs added
- [ ] I have not created/pushed release tags or published a release (owner action)
- [ ] Version impact considered (PATCH/MINOR/MAJOR)

## Notes for reviewers

<!-- Anything risky, migrations, or follow-ups. -->
