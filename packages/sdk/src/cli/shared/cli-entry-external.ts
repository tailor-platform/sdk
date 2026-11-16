import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { RolldownMagicString, type Plugin } from "rolldown";
import { walkBindingAware } from "#/cli/shared/binding-aware-walk";
import { CLIError } from "#/cli/shared/errors";
import type { HookFailures } from "#/cli/services/hook-failures";

const CLI_ENTRY = "@tailor-platform/sdk/cli";
const PLUGINS = "plugins";
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

type SourceRange = { start: number; end: number };

function pluginsDeclaration(
  program: ReturnType<typeof parseSync>["program"],
): SourceRange | undefined {
  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    if (node.declaration?.type !== "VariableDeclaration") continue;
    const declared = node.declaration.declarations;
    if (
      declared.length === 1 &&
      declared[0]?.id.type === "Identifier" &&
      declared[0].id.name === PLUGINS
    ) {
      return { start: node.start, end: node.end };
    }
  }
  return undefined;
}

function isReferencedElsewhere(
  program: ReturnType<typeof parseSync>["program"],
  declaration: SourceRange,
): boolean {
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

function importsCliEntry(code: string, file: string): boolean {
  const { program } = parseSync(file, code);
  return program.body.some(
    (node) =>
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source?.value === CLI_ENTRY,
  );
}

/**
 * Keep `@tailor-platform/sdk/cli` out of the bundles of code that runs on the Platform.
 *
 * `tailor.config.ts` is bundled into functions that run on the Platform, such as auth hooks, so
 * the CLI entry point a plugin's `build` function imports there would be bundled with it, and its
 * native binding cannot be loaded. The entry point is resolved as an external module without side
 * effects, so rolldown drops every import that nothing uses without loading it, and the `plugins`
 * export, which only `tailor deploy` reads, is removed from the project's modules so the
 * functions it registers go with it. An import still in the bundle then belongs to code that runs
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
