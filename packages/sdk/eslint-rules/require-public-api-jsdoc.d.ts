import type { CompilerOptions } from "typescript";
import type { Rule } from "eslint";

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

export const rule: Rule.RuleModule;
