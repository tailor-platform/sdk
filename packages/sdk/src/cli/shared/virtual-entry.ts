import type { Plugin } from "rolldown";

type VirtualEntry = {
  input: string;
  plugin: Plugin;
};

/**
 * Create an in-memory rolldown entry module with a deterministic ID.
 * @param name - Logical entry name
 * @param code - Entry module source
 * @param sourceType - Parser type for the generated module
 * @param resolutionBasis - Source file whose directory resolves generated imports
 * @returns Rolldown input and plugin for loading the entry
 */
export function createVirtualEntry(
  name: string,
  code: string,
  sourceType: "js" | "ts" = "js",
  resolutionBasis?: string,
): VirtualEntry {
  const input = `tailor-sdk-entry:${name}.${sourceType}`;
  const resolvedId = `\0${input}`;

  return {
    input,
    plugin: {
      name: "tailor-sdk-virtual-entry",
      async resolveId(source, importer) {
        if (source === input && importer === undefined) return resolvedId;
        if (importer !== resolvedId || !resolutionBasis) return null;
        return this.resolve(source, resolutionBasis, { skipSelf: true });
      },
      load(id) {
        return id === resolvedId ? code : null;
      },
    },
  };
}
