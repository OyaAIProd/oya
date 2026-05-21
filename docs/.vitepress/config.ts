import { defineConfig } from "vitepress";

export default defineConfig({
  title: "oya",
  description: "A plan-don't-react framework for LLM agents.",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Concepts", link: "/concepts/projection-types" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [{ text: "Getting Started", link: "/guide/getting-started" }],
      },
      {
        text: "Concepts",
        items: [
          { text: "Projection Types", link: "/concepts/projection-types" },
          { text: "The Plan IR", link: "/concepts/plan-ir" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/oya-labs/oya" }],
    footer: {
      message: "Released under the MIT License.",
      copyright: "© 2026 Oya Labs, Inc.",
    },
  },
});
