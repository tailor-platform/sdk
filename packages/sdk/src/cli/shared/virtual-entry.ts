import type { Plugin } from "rolldown";

type VirtualEntry = {
  input: string;
  plugin: Plugin;
};

/**
 * Create an in-memory rolldown entry module with a deterministic ID.
 * @param name - Logical entry name
 * @param code - Entry module source
 * @returns Rolldown input and plugin for loading the entry
 */
export function createVirtualEntry(name: string, code: string): VirtualEntry {
  const input = `tailor-sdk-entry:${name}`;
  const resolvedId = `\0${input}`;

  return {
    input,
    plugin: {
      name: "tailor-sdk-virtual-entry",
      resolveId(source) {
        return source === input ? resolvedId : null;
      },
      load(id) {
        return id === resolvedId ? code : null;
      },
    },
  };
}
