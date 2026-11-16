import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { parseSync } from "oxc-parser";
import { CLIError } from "#/cli/shared/errors";
import type { HookFailures } from "#/cli/services/hook-failures";
import type { Plugin } from "rolldown";

const CLI_ENTRY = "@tailor-platform/sdk/cli";
const STUB_PREFIX = "\0tailor-platform-sdk-cli-stub:";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

type ExportedNameNode = { type: string; name?: string; value?: unknown };

function exportToken(nonce: string, name: string): string {
  return `${CLI_ENTRY}#${nonce}#${name}`;
}

function exportedName(name: ExportedNameNode): string {
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
 * the modules are found in. A name that is still in the bundle after unused code is removed is
 * reachable from code that runs on the Platform, so the build fails with the names left over.
 * @param hookFailures - Keeps the failure until the build is over
 * @returns Rolldown plugin that stubs the CLI entry point
 */
export function createDeployOnlyCliStubPlugin(hookFailures: HookFailures): Plugin {
  // Marks each stubbed export in the bundle. The nonce keeps user code from containing a marker.
  const nonce = randomUUID();
  const exportTokens = new RegExp(`${CLI_ENTRY}#${nonce}#([A-Za-z_$][\\w$]*)`, "g");
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
        `function deployOnly(token) {`,
        `  const fail = () => { throw new Error(token + " only works where tailor deploy runs"); };`,
        `  return new Proxy(function () {}, { get: fail, set: fail, apply: fail, construct: fail });`,
        `}`,
        ...names.map(
          (name) =>
            `export const ${name} = /* @__PURE__ */ deployOnly(${JSON.stringify(exportToken(nonce, name))});`,
        ),
      ].join("\n");
    },
    generateBundle(_, bundle) {
      const remaining = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [, name] of output.code.matchAll(exportTokens)) {
          if (name) remaining.add(name);
        }
      }
      if (remaining.size === 0) return;
      const names = [...remaining].toSorted();
      hookFailures.record(
        CLIError({
          code: "DEPLOY_ONLY_CLI_IMPORT",
          message: `${CLI_ENTRY} is used by code that runs on the Platform.`,
          details: `Used: ${names.join(", ")}`,
          suggestion: `Use ${CLI_ENTRY} only inside a plugin's build or onDeployed function, which runs where \`tailor deploy\` runs. A call at the top level of tailor.config.ts or in a resolver, executor or hook body runs on the Platform, where this entry point does not work.`,
          context: { names },
        }),
      );
    },
  };
}
