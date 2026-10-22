import { defineConfig } from "vitepress";

export default defineConfig({
  title: "AgentOps Rules",
  description:
    "A portable, verifiable operating protocol for autonomous coding agents on OpenCode: intent, state, evidence, worktrees, integration, deployments and benchmarks.",
  base: "/agentops-rules/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#0f172a" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Reference", link: "/cli-reference" },
      { text: "Versioning", link: "/versioning" },
      {
        text: "GitHub",
        link: "https://github.com/J-Akiru5/agentops-rules",
      },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "OpenCode 2", link: "/opencode-2" },
          { text: "Worktrees", link: "/worktrees" },
          { text: "Subagents and benchmarks", link: "/subagents" },
          { text: "Deployment governance", link: "/deployment-governance" },
          { text: "Team plan", link: "/team-plan" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/cli-reference" },
          { text: "Policy", link: "/policy-reference" },
          { text: "Task contracts", link: "/contract-reference" },
          { text: "Versioning", link: "/versioning" },
          { text: "Releasing", link: "/releasing" },
          { text: "Migrations", link: "/migrations" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Security", link: "/security" },
          { text: "Contributing", link: "/contributing" },
          {
            text: "Changelog",
            link: "https://github.com/J-Akiru5/agentops-rules/blob/main/CHANGELOG.md",
          },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/J-Akiru5/agentops-rules" }],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/J-Akiru5/agentops-rules/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "© 2026 Jeff Akiru (J-Akiru5)",
    },
  },
});
