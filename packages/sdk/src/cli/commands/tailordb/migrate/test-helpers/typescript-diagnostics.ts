import * as path from "pathe";
import ts from "typescript";

const packageRoot = path.resolve(import.meta.dirname, "../../../../../..");

export function getTypeScriptDiagnostics(
  filePath: string,
): readonly { code: number; messageText: string }[] {
  const program = ts.createProgram([filePath], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: {
      "@tailor-platform/sdk": [path.join(packageRoot, "src/configure/index.ts")],
      "@tailor-platform/sdk/kysely": [path.join(packageRoot, "src/kysely/index.ts")],
      "@tailor-platform/sdk/vitest": [path.join(packageRoot, "src/vitest/index.ts")],
      "@electric-sql/pglite": [path.join(packageRoot, "node_modules/@electric-sql/pglite")],
      vitest: [path.join(packageRoot, "node_modules/vitest")],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === filePath)
    .map((diagnostic) => ({
      code: diagnostic.code,
      messageText: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
}
