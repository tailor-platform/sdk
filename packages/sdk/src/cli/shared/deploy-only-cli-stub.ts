import * as fs from "node:fs/promises";
import { parseSync } from "oxc-parser";
import type { Plugin } from "rolldown";

const CLI_ENTRY = "@tailor-platform/sdk/cli";
const STUB_PREFIX = "\0tailor-platform-sdk-cli-stub:";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function exportedName(name: { type: string; name?: string; value?: unknown }): string {
  return name.type === "Identifier" ? String(name.name) : String(name.value);
}

function exportedNamesOf(code: string, file: string): string[] {
  const names = new Set<string>();
  const { program } = parseSync(file, code);
  for (const node of program.body) {
    if (node.type === "ExportAllDeclaration" && node.exported) {
      names.add(exportedName(node.exported));
    }
    if (node.type !== "ExportNamedDeclaration") continue;
    for (const specifier of node.specifiers) names.add(exportedName(specifier.exported));
    const declaration = node.declaration;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") names.add(declarator.id.name);
      }
    } else if (declaration && "id" in declaration && declaration.id?.type === "Identifier") {
      names.add(declaration.id.name);
    }
  }
  return [...names].filter((name) => name !== "default" && IDENTIFIER.test(name));
}

/**
 * Replace `@tailor-platform/sdk/cli` with a module that declares the same names as values that
 * throw when called, read, or written, whether the real export is a function, an object, or a constant. The entry point only works where `tailor deploy` runs, and rolldown loads every
 * module it can reach before it removes unused code, so the real module (which needs a native
 * binding) would fail the bundle even when the import is never used on the Platform. Declaring
 * every name keeps named, re-exported, namespace and dynamic imports resolvable whatever order
 * the modules are found in.
 * @returns Rolldown plugin that stubs the CLI entry point
 */
export function createDeployOnlyCliStubPlugin(): Plugin {
  return {
    name: "tailor-deploy-only-cli-stub",
    async resolveId(source, importer) {
      if (source !== CLI_ENTRY || !importer) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || resolved.external) return null;
      const id = resolved.id.startsWith(STUB_PREFIX) ? resolved.id : STUB_PREFIX + resolved.id;
      return { id, moduleSideEffects: false };
    },
    async load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null;
      const file = id.slice(STUB_PREFIX.length);
      const names = exportedNamesOf(await fs.readFile(file, "utf8"), file);
      return [
        `function deployOnly() {`,
        `  const fail = () => { throw new Error("${CLI_ENTRY} only works where tailor deploy runs"); };`,
        `  return new Proxy(function () {}, { get: fail, set: fail, apply: fail, construct: fail });`,
        `}`,
        ...names.map((name) => `export const ${name} = /* @__PURE__ */ deployOnly();`),
      ].join("\n");
    },
  };
}
