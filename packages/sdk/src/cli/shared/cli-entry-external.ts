import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { RolldownMagicString, type Plugin } from "rolldown";
import { walkBindingAware } from "#/cli/shared/binding-aware-walk";
import { CLIError } from "#/cli/shared/errors";
import type { HookFailures } from "#/cli/services/hook-failures";
import type { ASTNode } from "#/cli/services/workflow/ast-utils";
import type { Expression, Program } from "@oxc-project/types";

const CLI_ENTRY = "@tailor-platform/sdk/cli";
const PLUGINS = "plugins";
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

type SourceRange = { start: number; end: number };

const SDK_MODULE = "@tailor-platform/sdk";
const DEFINE_PLUGINS = "definePlugins";

function definePluginsBindings(program: Program): { named: Set<string>; namespaces: Set<string> } {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== SDK_MODULE) continue;
    for (const specifier of node.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported;
      const name = imported.type === "Identifier" ? imported.name : imported.value;
      if (name === DEFINE_PLUGINS) named.add(specifier.local.name);
    }
  }
  return { named, namespaces };
}

function isDefinePluginsCall(init: Expression | null | undefined, program: Program): boolean {
  if (init?.type !== "CallExpression") return false;
  const { named, namespaces } = definePluginsBindings(program);
  const callee = init.callee;
  if (callee.type === "Identifier") return named.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    namespaces.has(callee.object.name) &&
    callee.property.type === "Identifier" &&
    callee.property.name === DEFINE_PLUGINS
  );
}

function pluginsDeclaration(program: Program): SourceRange | undefined {
  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    if (node.declaration?.type !== "VariableDeclaration") continue;
    const declared = node.declaration.declarations;
    const [only] = declared;
    if (
      declared.length === 1 &&
      only?.id.type === "Identifier" &&
      only.id.name === PLUGINS &&
      isDefinePluginsCall(only.init, program)
    ) {
      return { start: node.start, end: node.end };
    }
  }
  return undefined;
}

function isReferencedElsewhere(program: Program, declaration: SourceRange): boolean {
  let referenced = false;
  walkBindingAware(program, new Set([PLUGINS]), (node, shadowed, parent, key) => {
    if (node.type !== "Identifier" || node.name !== PLUGINS || shadowed.has(PLUGINS)) return;
    const start = node.start as number;
    if (start >= declaration.start && start < declaration.end) return;
    if (parent?.type === "MemberExpression" && key === "property" && parent.computed !== true)
      return;
    referenced = true;
  });
  return referenced;
}

function literalText(node: ASTNode | undefined): string | undefined {
  if (node?.type === "Literal") return node.value as string;
  if (node?.type !== "TemplateLiteral") return undefined;
  const quasis = node.quasis as Array<{ value: { cooked: string | null } }>;
  const expressions = node.expressions as unknown[];
  return expressions.length === 0 ? (quasis[0]?.value.cooked ?? undefined) : undefined;
}

function importsCliEntry(code: string, file: string): boolean {
  const { program } = parseSync(file, code);
  const statically = program.body.some(
    (node) =>
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source?.value === CLI_ENTRY,
  );
  if (statically) return true;
  let dynamically = false;
  walkBindingAware(program, new Set(), (node) => {
    if (node.type === "ImportExpression" && literalText(node.source as ASTNode) === CLI_ENTRY) {
      dynamically = true;
    }
  });
  return dynamically;
}

/**
 * Keep `@tailor-platform/sdk/cli` out of the bundles of code that runs on the Platform.
 *
 * `tailor.config.ts` is bundled into functions that run on the Platform, such as auth hooks, so
 * the CLI entry point a plugin's `build` function imports there would be bundled with it, and its
 * native binding cannot be loaded. The entry point is resolved as an external module without side
 * effects, so rolldown drops every import that nothing uses without loading it, and the plugins
 * registered with `definePlugins` in a `plugins` export, which only `tailor deploy` reads, are
 * removed from the project's modules so the functions they hold go with them. An import still in the bundle then belongs to code that runs
 * on the Platform, and the build fails naming the modules that import it.
 * @param hookFailures - Keeps the failure until the build is over
 * @returns Rolldown plugin
 */
export function createCliEntryExternalPlugin(hookFailures: HookFailures): Plugin {
  const importers = new Set<string>();
  return {
    name: "cli-entry-external",
    resolveId(source) {
      return source === CLI_ENTRY ? { id: source, external: true, moduleSideEffects: false } : null;
    },
    transform(code, id) {
      if (id.includes("/node_modules/") || !SOURCE_FILE.test(id)) return null;
      if (code.includes(CLI_ENTRY) && importsCliEntry(code, id)) importers.add(id);
      if (!code.includes(PLUGINS)) return null;
      const { program } = parseSync(id, code);
      const declaration = pluginsDeclaration(program);
      if (!declaration || isReferencedElsewhere(program, declaration)) return null;
      const source = new RolldownMagicString(code);
      source.remove(declaration.start, declaration.end);
      return { code: source.toString(), map: source.generateMap({ hires: "boundary" }).toString() };
    },
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
      if (!chunks.some((chunk) => importsCliEntry(chunk.code, chunk.fileName))) return;
      const rendered = new Set(
        chunks.flatMap((chunk) =>
          Object.entries(chunk.modules)
            .filter(([, info]) => info.renderedLength > 0)
            .map(([id]) => id),
        ),
      );
      const retained = [...importers].filter((id) => rendered.has(id));
      const files = (retained.length > 0 ? retained : [...importers]).map((id) =>
        path.relative(process.cwd(), id),
      );
      hookFailures.record(
        CLIError({
          code: "DEPLOY_ONLY_CLI_IMPORT",
          message: `${CLI_ENTRY} is used by code that runs on the Platform.`,
          details: files.map((file) => `- ${file}`).join("\n") || undefined,
          suggestion: `Use ${CLI_ENTRY} only inside a plugin's build or onDeployed function, which runs where \`tailor deploy\` runs.`,
          context: { files },
        }),
      );
    },
  };
}
