# Copy-paste prompt for the other laptop

Paste everything inside the block into OpenCode (or PowerShell) on the other laptop.

```text
Install our team's global OpenCode development rules on this Windows machine.

1. Download and extract the package (GitHub is authenticated with gh):
   gh release download v1.1.0 --repo J-Akiru5/agentops-rules --pattern agentops-rules.zip --dir $env:TEMP --clobber
   Remove-Item "$env:TEMP\agentops-rules" -Recurse -Force -ErrorAction SilentlyContinue
   Expand-Archive "$env:TEMP\agentops-rules.zip" "$env:TEMP\agentops-rules" -Force

   If gh is not signed in, run `gh auth login --web` first, or use:
   git clone https://github.com/J-Akiru5/agentops-rules.git $env:TEMP\agentops-rules

2. Run the installer:
   node "$env:TEMP\agentops-rules\install.mjs"

3. Report the exact output. The installer auto-detects OpenCode V1/V2 and fixes an invalid
   V2 `permissions` array on V1. If it reports a config error, stop and paste the exact error.

4. Do not run `opencode`, `vercel`, or any deployment. Do not edit the config by hand.

5. After it succeeds, the user restarts OpenCode and starts a fresh session. Verify:
   - "What is your waiting/status protocol?"
   - "Which branches may trigger Vercel deployments?"
   - node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" help
```

## If you prefer Git instead of the release zip

```text
Install our team's global OpenCode development rules on this Windows machine.

1. git clone https://github.com/J-Akiru5/agentops-rules.git $env:TEMP\agentops-rules
2. node "$env:TEMP\agentops-rules\install.mjs"
3. Report the exact output. Do not run opencode or any deployment. If the installer reports an
   error, stop and paste it.
4. The user will restart OpenCode and verify the waiting/status and deployment policies.
```
