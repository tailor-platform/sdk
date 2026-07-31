import * as path from "pathe";
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

/**
 * Resolve bare imports in a generated on-disk entry from its owning project.
 *
 * Generated entries live under the CLI output directory, which may be outside
 * the project selected by a config path. Resolving their injected dependencies
 * from that output directory would ignore the selected project's installation.
 * @param entryPath - Absolute path of the generated entry
 * @param projectDir - Directory whose dependencies the generated entry uses
 * @returns Rolldown plugin that rebases generated bare imports
 */
export function createGeneratedEntryResolverPlugin(entryPath: string, projectDir: string): Plugin {
  const normalizedEntryPath = path.resolve(entryPath);
  const resolutionBasis = path.join(path.resolve(projectDir), "__tailor_sdk_generated_entry__.js");

  return {
    name: "tailor-sdk-generated-entry-resolver",
    async resolveId(source, importer) {
      if (
        importer === undefined ||
        path.resolve(importer) !== normalizedEntryPath ||
        source.startsWith(".") ||
        path.isAbsolute(source) ||
        source.startsWith("\0")
      ) {
        return null;
      }
      return this.resolve(source, resolutionBasis, { skipSelf: true });
    },
  };
}
