import type { Plugin } from "@tailor-platform/sdk";

const onNamespaceLoaded: Plugin["onNamespaceLoaded"] = () => ({});

export const shorthand: Plugin = { id: "a", description: "a", importPath: "a", onNamespaceLoaded };
export const arrow: Plugin = { id: "b", description: "b", importPath: "b", onNamespaceLoaded: () => ({}) };
export const quoted: Plugin = { id: "c", description: "c", importPath: "c", "onNamespaceLoaded": () => ({}) };
export const asyncMethod: Plugin = {
  id: "d",
  description: "d",
  importPath: "d",
  async onNamespaceLoaded() {
    return {};
  },
};
