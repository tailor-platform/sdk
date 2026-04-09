import { parse, Lang } from "@ast-grep/napi";
import type { SgRoot } from "@ast-grep/napi";

/**
 * Parse TypeScript source code into an ast-grep root.
 * @param source - TypeScript source code
 * @returns Parsed AST root
 */
export function parseTS(source: string): SgRoot {
  return parse(Lang.TypeScript, source);
}

/**
 * Parse TSX source code into an ast-grep root.
 * @param source - TSX source code
 * @returns Parsed AST root
 */
export function parseTSX(source: string): SgRoot {
  return parse(Lang.Tsx, source);
}

export type { SgRoot, SgNode, Edit } from "@ast-grep/napi";
