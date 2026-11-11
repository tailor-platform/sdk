import { API } from "typescript/sync";
import type { Diagnostic, Program, RawCompilerOptions } from "typescript/sync";

export function createTypeChecker() {
  const api = new API();
  return {
    api,
    diagnostics(rootFiles: readonly string[], options: RawCompilerOptions): Diagnostic[] {
      return programDiagnostics(api.createProgram(rootFiles, options), options);
    },
    close: () => api.close(),
  };
}

export function programDiagnostics(program: Program, options: RawCompilerOptions): Diagnostic[] {
  return [
    ...program.getProgramDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...(options.declaration ? program.getDeclarationDiagnostics() : []),
  ];
}

export function flattenDiagnosticText(
  diagnostic: Pick<Diagnostic, "text" | "messageChain">,
  newLine: string,
  indent = 0,
): string {
  let result = "";
  if (indent) {
    result += newLine + "  ".repeat(indent);
  }
  result += diagnostic.text;
  for (const next of diagnostic.messageChain ?? []) {
    result += flattenDiagnosticText(next, newLine, indent + 1);
  }
  return result;
}
