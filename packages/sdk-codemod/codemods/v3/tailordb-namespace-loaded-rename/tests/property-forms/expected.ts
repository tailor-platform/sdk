import type { Plugin } from "@tailor-platform/sdk";

const onNamespaceLoaded: Plugin["onTailorDBNamespaceLoaded"] = () => ({});

export const shorthand: Plugin = { id: "a", description: "a", importPath: "a", onTailorDBNamespaceLoaded: onNamespaceLoaded };
export const arrow: Plugin = { id: "b", description: "b", importPath: "b", onTailorDBNamespaceLoaded: () => ({}) };
export const quoted: Plugin = { id: "c", description: "c", importPath: "c", "onTailorDBNamespaceLoaded": () => ({}) };
export const asyncMethod: Plugin = {
  id: "d",
  description: "d",
  importPath: "d",
  async onTailorDBNamespaceLoaded() {
    return {};
  },
};
