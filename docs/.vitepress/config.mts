import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Blackbox",
  description: "Record your AI agent's run, replay it offline, fork it with one fact changed, and diff to the first divergence.",
  base: "/blackbox/",
  srcExclude: ["history/**"],
  cleanUrls: true,
  lastUpdated: false,
  head: [["meta", { name: "theme-color", content: "#0d1117" }]],
  themeConfig: {
    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "CLI", link: "/cli" },
      { text: "Changelog", link: "https://github.com/arda-ulas/blackbox/blob/master/CHANGELOG.md" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Quickstart", link: "/quickstart" },
          { text: "Concepts", link: "/concepts" },
          { text: "Worked example", link: "/worked-example" },
        ],
      },
      {
        text: "Examples",
        items: [
          { text: "Root-causing a triage agent", link: "/example-fleet-triage" },
          { text: "What did my coding agent do?", link: "/example-claude-code" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Integrations", link: "/integrations" },
          { text: "Use in CI", link: "/ci" },
          { text: "Import transcripts", link: "/import" },
          { text: "Limitations", link: "/limitations" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/cli" },
          { text: "Trace format", link: "/trace-format" },
          { text: "Architecture", link: "/architecture" },
          { text: "Comparison", link: "/comparison" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/arda-ulas/blackbox" }],
    search: { provider: "local" },
    editLink: { pattern: "https://github.com/arda-ulas/blackbox/edit/master/docs/:path" },
    footer: { message: "MIT licensed" },
  },
});
