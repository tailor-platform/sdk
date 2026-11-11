import type { CompilerOptions } from "typescript/sync";

interface Failure {
  name: string;
  kind: string;
  location: string;
}

export function findUndocumentedSymbols(
  entryPoints: string[],
  tsCompilerOptions: CompilerOptions,
  baseDir: string,
): Failure[];
