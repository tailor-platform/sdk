import * as fs from "node:fs";
import { createPathsMatcher, getTsconfig, type Cache } from "get-tsconfig";
import * as path from "pathe";
import { excerptOf, lineOf, parseRoot } from "../ast-grep-helpers";
import type { LlmReviewFinding, ProjectFiles } from "../types";
import type { SgNode } from "@ast-grep/napi";

const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

/** The `tsconfig.json` nearest to a directory, which the SDK resolves its files' aliases with. */
export type NearestTsconfig =
  | { path: string; matcher: ((specifier: string) => string[]) | null }
  | { path: string; error: string };

/** A project file that an import names through a tsconfig `paths` alias. */
export type AliasTarget = {
  /** Project-relative path of the file. */
  file: string;
  /** Project-relative path the alias maps the specifier to, before extensions are tried. */
  mapped: string;
  /** Project-relative path of the tsconfig whose `paths` holds the alias. */
  tsconfig: string;
};

/** The `package.json` nearest to a directory. */
export type NearestPackageJson = {
  /** Project-relative path. */
  path: string;
  data: Record<string, unknown>;
};

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * Whether a package.json declares a package as a dependency of any kind.
 * @param packageJson - The package.json
 * @param name - The package name
 * @returns Whether one of its dependency fields lists the package
 */
export function declaresDependency(packageJson: NearestPackageJson, name: string): boolean {
  return DEPENDENCY_FIELDS.some((field) => {
    const dependencies = packageJson.data[field];
    return typeof dependencies === "object" && dependencies !== null && name in dependencies;
  });
}

function tsconfigAbove(directory: string): string {
  for (let current = directory; ; current = path.dirname(current)) {
    const candidate = path.join(current, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(current) === current) return path.join(directory, "tsconfig.json");
  }
}

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
  private readonly tsconfigs = new Map<string, NearestTsconfig | null>();
  private readonly tsconfigFiles: Cache = new Map();
  private readonly packageJsons = new Map<string, NearestPackageJson | null>();

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
   * Resolve an import specifier to a project file: a relative one, or one a `paths` alias of the
   * importing file's nearest tsconfig maps to a project file.
   * @param fromPath - Project-relative path of the importing file
   * @param specifier - The import specifier
   * @returns The project-relative path of the imported file, or null when it is not a project file
   */
  resolve(fromPath: string, specifier: string): string | null {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return this.resolveFile(path.join(path.dirname(fromPath), specifier));
    }
    return this.aliasTarget(fromPath, specifier)?.file ?? null;
  }

  /**
   * The project file a `paths` alias of the importing file's nearest tsconfig maps a specifier to.
   * @param fromPath - Project-relative path of the importing file
   * @param specifier - The import specifier
   * @returns The target, or null when no alias maps the specifier to a project file
   */
  aliasTarget(fromPath: string, specifier: string): AliasTarget | null {
    const tsconfig = this.nearestTsconfig(path.dirname(fromPath));
    if (tsconfig === null || "error" in tsconfig || tsconfig.matcher === null) return null;
    for (const candidate of tsconfig.matcher(specifier)) {
      const mapped = path.relative(this.project.root, candidate);
      const file = this.resolveFile(mapped);
      if (file !== null) return { file, mapped, tsconfig: tsconfig.path };
    }
    return null;
  }

  /**
   * The `tsconfig.json` nearest to a directory, searching up to the filesystem root.
   * @param relativeDir - Project-relative directory
   * @returns The tsconfig with its `paths` matcher, the error that kept it from loading, or null when there is none
   */
  nearestTsconfig(relativeDir: string): NearestTsconfig | null {
    if (this.tsconfigs.has(relativeDir)) return this.tsconfigs.get(relativeDir)!;
    const directory = path.join(this.project.root, relativeDir);
    let found: NearestTsconfig | null;
    try {
      const tsconfig = getTsconfig(directory, "tsconfig.json", this.tsconfigFiles);
      found = tsconfig && {
        path: path.relative(this.project.root, tsconfig.path),
        matcher: createPathsMatcher(tsconfig),
      };
    } catch (error) {
      found = {
        path: path.relative(this.project.root, tsconfigAbove(directory)),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.tsconfigs.set(relativeDir, found);
    return found;
  }

  /**
   * The `package.json` nearest to a directory, searching up to the filesystem root.
   * @param relativeDir - Project-relative directory
   * @returns The package.json, or null when there is none or it is not a JSON object
   */
  nearestPackageJson(relativeDir: string): NearestPackageJson | null {
    if (this.packageJsons.has(relativeDir)) return this.packageJsons.get(relativeDir)!;
    const candidate = path.join(relativeDir, "package.json");
    const source = this.project.read(candidate);
    let found: NearestPackageJson | null;
    if (source === undefined) {
      const parent = path.join(relativeDir, "..");
      const atRoot =
        path.resolve(this.project.root, parent) === path.resolve(this.project.root, relativeDir);
      found = atRoot ? null : this.nearestPackageJson(parent);
    } else {
      let data: unknown;
      try {
        data = JSON.parse(source);
      } catch {
        data = null;
      }
      found =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? { path: candidate, data: data as Record<string, unknown> }
          : null;
    }
    this.packageJsons.set(relativeDir, found);
    return found;
  }

  private resolveFile(base: string): string | null {
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
