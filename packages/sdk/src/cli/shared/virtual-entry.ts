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
 * @returns Rolldown input and plugin for loading the entry
 */
export function createVirtualEntry(
  name: string,
  code: string,
  sourceType: "js" | "ts" = "js",
): VirtualEntry {
  const input = `tailor-entry:${name}.${sourceType}`;
  const resolvedId = `\0${input}`;

  return {
    input,
    plugin: {
      name: "tailor-virtual-entry",
      resolveId(source, importer) {
        return source === input && importer === undefined ? resolvedId : null;
      },
      load(id) {
        return id === resolvedId ? code : null;
      },
    },
  };
}
