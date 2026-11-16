import * as fs from "node:fs/promises";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { walkBindingAware } from "#/cli/shared/binding-aware-walk";
import { withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError } from "#/cli/shared/errors";
import type { HookFailures } from "#/cli/services/hook-failures";
import type { ASTNode } from "#/cli/services/workflow/ast-utils";
import type { Plugin } from "rolldown";

const CLI_ENTRY = "@tailor-platform/sdk/cli";
const STUB_PREFIX = "\0tailor-platform-sdk-cli-stub:";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const FUNCTION_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "TSDeclareFunction",
]);
const NAME_POSITIONS = new Set(["Property", "PropertyDefinition", "MethodDefinition"]);

type ExportedNameNode = { type: string; name?: string; value?: unknown };

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

function importedBindings(program: ReturnType<typeof parseSync>["program"]): Set<string> {
  const names = new Set<string>();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== CLI_ENTRY) continue;
    if (node.importKind === "type") continue;
    for (const specifier of node.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type") {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
}

function isValueReference(parent: ASTNode | undefined, key: string | undefined): boolean {
  if (!parent) return true;
  const type = String(parent.type);
  if (type.startsWith("TS") || type === "ExportSpecifier") return false;
  if (type === "MemberExpression") return key !== "property" || parent.computed === true;
  if (NAME_POSITIONS.has(type)) return key !== "key" || parent.computed === true;
  return true;
}

type TopLevelUse = { name: string; line: number };

function topLevelUses(code: string, file: string): TopLevelUse[] {
  const { program } = parseSync(file, code);
  const names = importedBindings(program);
  if (names.size === 0) return [];
  const functions: Array<[number, number]> = [];
  const uses: TopLevelUse[] = [];
  walkBindingAware(program, names, (node, shadowed, parent, key) => {
    const start = node.start as number;
    const end = node.end as number;
    if (FUNCTION_LIKE.has(String(node.type))) {
      functions.push([start, end]);
      return;
    }
    if (node.type !== "Identifier") return;
    const name = node.name as string;
    if (!names.has(name) || shadowed.has(name) || !isValueReference(parent, key)) return;
    if (functions.some(([from, to]) => start >= from && end <= to)) return;
    uses.push({ name, line: code.slice(0, start).split("\n").length });
  });
  return uses;
}

/**
 * Replace `@tailor-platform/sdk/cli` with a module that declares the same names as values that
 * throw when called, read, or written, whether the real export is a function, an object, or a
 * constant. The entry point only works where `tailor deploy` runs, and rolldown loads every
 * module it can reach before it removes unused code, so the real module (which needs a native
 * binding) would fail the bundle even when the import is never used on the Platform. Declaring
 * every name keeps named, re-exported, namespace and dynamic imports resolvable whatever order
 * the modules are found in. A use outside any function runs when the module loads on the
 * Platform, so the build fails there; a use inside a function throws when that function runs.
 * @param hookFailures - Keeps the failure until the build is over
 * @returns Rolldown plugin that stubs the CLI entry point
 */
export function createDeployOnlyCliStubPlugin(hookFailures: HookFailures): Plugin {
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
    transform(code, id) {
      if (id.startsWith("\0") || id.includes("/node_modules/") || !SOURCE_FILE.test(id))
        return null;
      if (!code.includes(CLI_ENTRY)) return null;
      const uses = topLevelUses(code, id);
      const [first] = uses;
      if (!first) return null;
      const names = [...new Set(uses.map((use) => use.name))];
      hookFailures.record(
        withErrorDiagnostics(
          CLIError({
            code: "DEPLOY_ONLY_CLI_IMPORT",
            message: `${CLI_ENTRY} is used outside any function, so it runs when the module loads on the Platform.`,
            details: uses.map((use) => `- ${use.name} (line ${use.line})`).join("\n"),
            suggestion: `Use ${CLI_ENTRY} inside a plugin's build or onDeployed function, which runs where \`tailor deploy\` runs. Code that runs on the Platform, such as an auth hook, a resolver or an executor, cannot use it.`,
            context: { file: path.relative(process.cwd(), id), names },
          }),
          { location: { file: id, line: first.line } },
        ),
      );
      return null;
    },
  };
}
