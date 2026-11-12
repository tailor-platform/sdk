import { parseSync } from "oxc-parser";
import type { Plugin } from "rolldown";

const CLI_ENTRY = "@tailor-platform/sdk/cli";
const STUB_PREFIX = "\0tailor-platform-sdk-cli-stub:";

function exportedName(name: { type: string; name?: string; value?: unknown }): string {
  return name.type === "Identifier" ? String(name.name) : String(name.value);
}

function cliNamesOf(code: string, id: string): Set<string> {
  const names = new Set<string>();
  const { program } = parseSync(id, code);
  for (const node of program.body) {
    if (node.type === "ImportDeclaration" && node.source.value === CLI_ENTRY) {
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier") names.add(exportedName(specifier.imported));
      }
    }
    if (node.type === "ExportNamedDeclaration" && node.source?.value === CLI_ENTRY) {
      for (const specifier of node.specifiers) names.add(exportedName(specifier.local));
    }
  }
  return names;
}

/**
 * Replace `@tailor-platform/sdk/cli` with an empty module per importing module, declaring only the
 * names that module asks for. The entry point only works where `tailor deploy` runs, and rolldown
 * loads every module it can reach before it removes unused code, so the real module (which needs a
 * native binding) would fail the bundle even when the import is never used on the Platform.
 * @returns Rolldown plugin that stubs the CLI entry point
 */
export function createDeployOnlyCliStubPlugin(): Plugin {
  const namesByImporter = new Map<string, Set<string>>();
  return {
    name: "tailor-deploy-only-cli-stub",
    transform(code, id) {
      if (code.includes(CLI_ENTRY)) namesByImporter.set(id, cliNamesOf(code, id));
      return null;
    },
    resolveId(source, importer) {
      if (source !== CLI_ENTRY || !importer) return null;
      return { id: STUB_PREFIX + importer, moduleSideEffects: false };
    },
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null;
      const names = namesByImporter.get(id.slice(STUB_PREFIX.length)) ?? [];
      return [...names]
        .map(
          (name) =>
            `export function ${name}() { throw new Error("${CLI_ENTRY} only works where tailor deploy runs"); }`,
        )
        .join("\n");
    },
  };
}
