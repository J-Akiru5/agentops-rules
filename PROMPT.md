# Copy-paste prompt for the other laptop

Paste the relevant block into OpenCode (or PowerShell) on the other laptop. **OpenCode 2 is the
primary target.** If you just upgraded from V1, the installer converts the old `permission` block to
V2 `permissions`.

## Install or upgrade (PowerShell, works even if OpenCode won't start)

```text
Install or upgrade our team's global OpenCode development rules on this Windows machine.

1. Download and extract the v1.2.0 package (GitHub is authenticated with gh):
   gh release download v1.2.0 --repo J-Akiru5/agentops-rules --pattern agentops-rules.zip --dir $env:TEMP --clobber
   Remove-Item "$env:TEMP\agentops-rules" -Recurse -Force -ErrorAction SilentlyContinue
   Expand-Archive "$env:TEMP\agentops-rules.zip" "$env:TEMP\agentops-rules" -Force

   If gh is missing or not signed in: gh auth login --web
   Fallback: git clone https://github.com/J-Akiru5/agentops-rules.git $env:TEMP\agentops-rules

2. Run the installer for OpenCode 2:
   node "$env:TEMP\agentops-rules\install.mjs" --opencode v2

   It migrates a V1 permission block to V2 permissions, backs up the old config, and installs the
   rules and agentctl.

3. Report the exact output. If it reports a config error, stop and paste the exact error.
   Do not run opencode, vercel, or any deployment. Do not edit the config by hand.
```

## Verify after restarting OpenCode 2

```text
Confirm the team AgentOps rules are active in OpenCode 2. Without using any tools, answer:
1. What are the fields of your waiting/status protocol?
2. Which branches may trigger Vercel deployments, and which are ineligible?
3. Where does AgentOps runtime state live, and why is it not shared across machines?

Then run:
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" help

Do not run opencode, vercel, or any deployment.
```

## Config sanity check (PowerShell)

```text
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.config/opencode/opencode.jsonc','utf8'));console.log({permissions:Array.isArray(c.permissions),v1Block:Object.hasOwn(c,'permission'),instructions:c.instructions.length,permissionRules:c.permissions?.length})"
```

Expected: `{"permissions":true,"v1Block":false,"instructions":5,"permissionRules":27}`.
