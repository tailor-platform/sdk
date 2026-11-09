import type { Plugin } from "@tailor-platform/sdk";

export const plugin: Plugin = {
  id: "@example/both",
  description: "Defines both names",
  importPath: "@example/both",
  onTailorDBNamespaceLoaded: () => ({}),
  onNamespaceLoaded: () => ({}),
};
