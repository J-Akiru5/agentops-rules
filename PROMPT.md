# Copy-paste prompts

## Install or update (PowerShell, works even if OpenCode won't start)

```text
Install or update our team's global OpenCode development rules on this Windows machine.

1. Download and extract the latest package:
   gh release download --repo J-Akiru5/agentops-rules --pattern agentops-rules.zip --dir $env:TEMP --clobber
   Remove-Item "$env:TEMP\agentops-rules" -Recurse -Force -ErrorAction SilentlyContinue
   Expand-Archive "$env:TEMP\agentops-rules.zip" "$env:TEMP\agentops-rules" -Force

   If gh is unavailable:
   git clone https://github.com/J-Akiru5/agentops-rules.git $env:TEMP\agentops-rules

2. Run the installer for OpenCode 2:
   node "$env:TEMP\agentops-rules\install.mjs" --opencode v2

   It migrates a V1 permission block to V2 permissions, backs up the old config, and installs the
   rules, the benchmark subagent and agentctl.

3. Report the exact output. If it reports a config error, stop and paste the exact error.
   Do not run opencode, vercel, or any deployment. Do not edit the config by hand.
```

## Verify after restarting OpenCode 2

```text
Confirm the team AgentOps rules are active in OpenCode 2. Without using any tools, answer:
1. What are the fields of your waiting/status protocol?
2. Which branches may trigger Vercel deployments, and which are ineligible?
3. Where does AgentOps runtime state live, and why is it not shared across machines?
4. What must happen before a release tag is pushed?
5. Can you apply development migrations and deploy develop without asking? What is required for main?

Then run:
node "$env:USERPROFILE\.config\opencode\bin\agentctl.mjs" help

Do not run opencode, vercel, or any deployment.
```

## Config sanity check (PowerShell)

```text
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.config/opencode/opencode.jsonc','utf8'));console.log({permissions:Array.isArray(c.permissions),v1Block:Object.hasOwn(c,'permission'),instructions:c.instructions.length,permissionRules:c.permissions?.length,benchmark:fs.existsSync(process.env.USERPROFILE+'/.config/opencode/agents/benchmark.md')})"
```

Expected: `{"permissions":true,"v1Block":false,"instructions":6,"permissionRules":27,"benchmark":true}`.
