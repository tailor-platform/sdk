import * as path from "pathe";
import { excerptOf, lineOf, parseRoot } from "../ast-grep-helpers";
import type { LlmReviewFinding, ProjectFiles } from "../types";
import type { SgNode } from "@ast-grep/napi";

const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

/** A parsed source file of the project. */
export type SourceModule = {
  /** Project-relative path. */
  path: string;
  source: string;
  root: SgNode;
};

/** Parses project files once per run. */
export class ModuleCache {
  private readonly modules = new Map<string, SourceModule | null>();

  constructor(readonly project: ProjectFiles) {}

  get(relativePath: string): SourceModule | null {
    if (this.modules.has(relativePath)) return this.modules.get(relativePath)!;
    const source = this.project.read(relativePath);
    const root = source === undefined ? null : parseRoot(source, relativePath);
    const module =
      root === null || source === undefined ? null : { path: relativePath, source, root };
    this.modules.set(relativePath, module);
    return module;
  }

  /**
   * Resolve a relative import specifier to a project file.
   * @param fromPath - Project-relative path of the importing file
   * @param specifier - The import specifier
   * @returns The project-relative path of the imported file, or null when it is not a project file
   */
  resolve(fromPath: string, specifier: string): string | null {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
    const base = path.join(path.dirname(fromPath), specifier);
    const stem = base.replace(/\.(?:[cm]?js|jsx)$/u, "");
    const candidates = [
      base,
      ...MODULE_EXTENSIONS.map((extension) => `${stem}${extension}`),
      ...MODULE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
    ];
    return candidates.find((candidate) => this.project.read(candidate) !== undefined) ?? null;
  }
}

/**
 * The relative import specifier from a file to another file.
 * @param fromPath - Project-relative path of the importing file
 * @param toPath - Project-relative path of the imported file, or a module specifier relative to it
 * @returns A specifier starting with `./` or `../`
 */
export function relativeSpecifier(fromPath: string, toPath: string): string {
  const relative = path.relative(path.dirname(fromPath), toPath);
  return relative.startsWith("../") ? relative : `./${relative}`;
}

/** Code left for a manual migration, at a node or, in a file that is not parsed, at a line. */
export type Report = { file: string; message: string; excerpt?: string } & (
  | { node: SgNode }
  | { line: number; excerpt: string }
);

/**
 * A finding for the runner's review output.
 * @param report - What to report, and where
 * @returns The finding
 */
export function toFinding(report: Report): LlmReviewFinding {
  if (!("node" in report)) {
    return {
      file: report.file,
      line: report.line,
      message: report.message,
      excerpt: report.excerpt,
    };
  }
  return {
    file: report.file,
    line: lineOf(report.node),
    message: report.message,
    excerpt: report.excerpt ?? excerptOf(report.node),
  };
}

/**
 * The text of a string literal or a template literal without substitutions.
 * @param node - Node to read
 * @returns The literal's text, or null for any other node
 */
export function literalText(node: SgNode | null | undefined): string | null {
  if (!node) return null;
  if (node.kind() === "string") return node.text().slice(1, -1);
  if (node.kind() === "template_string") {
    if (node.children().some((child) => child.kind() === "template_substitution")) return null;
    return node.text().slice(1, -1);
  }
  return null;
}
