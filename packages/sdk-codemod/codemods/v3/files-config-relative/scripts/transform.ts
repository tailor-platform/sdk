import * as fs from "node:fs";
import * as path from "pathe";
import {
  arrayElements,
  callArgument,
  entryKey,
  excerptOf,
  importSpecNames,
  isTypeOnlyImport,
  lineOf,
  objectEntries,
  pairValue,
  parseRoot,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import {
  analyzeServiceConfigs,
  findDefineConfigCalls,
  type Analysis,
  type DefineConfigCalls,
} from "../../../../src/define-config";
import { nodeRangeKey } from "../../../../src/source-strings";
import { SOURCE_EXTENSIONS, walkFiles } from "../../../../src/walk-files";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const NOT_THE_DEFAULT_EXPORT =
  "this defineConfig() call is not the module's default export, so its patterns resolve against the directory of the config file that loads it";
const LOADED_BY_ANOTHER_CONFIG =
  "loads this config, so its patterns resolve against that file's directory when the CLI loads it";

/** The config file's directory, and the project directory commands are assumed to run from. */
type Directories = { configDir: string; projectDir: string };

/** A module, by `moduleId`, and the names under which it exports the config. */
type ConfigCarrier = { id: string; names: ReadonlySet<string> };

/** A project source file, by its project-relative and absolute paths, with its contents. */
type SourceFile = { relative: string; file: string; source: string };

/** The pattern of a `files` or `ignores` entry without its quotes, with any leading `!` split off. */
type Pattern = { node: SgNode; negated: boolean; glob: string };

/** Whether any pattern matched a file, or the pattern whose glob threw. */
type GlobResult = { matched: boolean } | { failed: Pattern; error: unknown };

function parsePattern(node: SgNode, negatable: boolean): Pattern {
  const value = stringValue(node) ?? "";
  const negated = negatable && value.startsWith("!");
  return { node, negated, glob: negated ? value.slice(1) : value };
}

function globFrom(patterns: Pattern[], dir: string): GlobResult {
  for (const pattern of patterns) {
    try {
      if (fs.globSync(path.resolve(dir, pattern.glob)).length > 0) return { matched: true };
    } catch (error) {
      return { failed: pattern, error };
    }
  }
  return { matched: false };
}

function stringLiterals(array: SgNode | null): SgNode[] | null {
  if (array?.kind() !== "array") return null;
  const elements = arrayElements(array);
  return elements.every((element) => element.kind() === "string") ? elements : null;
}

function hasBackslash(elements: SgNode[]): boolean {
  return elements.some((element) => element.text().includes("\\"));
}

/** `glob`, written against `projectDir`, rewritten to name the same files from `configDir`. */
function rebase(glob: string, { configDir, projectDir }: Directories): string {
  const rebased = path.relative(configDir, path.resolve(projectDir, glob)) || ".";
  const leavesConfigDir = rebased === "." || rebased === ".." || rebased.startsWith("../");
  return (glob.startsWith("./") || rebased.startsWith("!")) && !leavesConfigDir
    ? `./${rebased}`
    : rebased;
}

function rebaseEdit(pattern: Pattern, dirs: Directories): Edit {
  const quote = pattern.node.text()[0];
  return pattern.node.replace(
    `${quote}${pattern.negated ? "!" : ""}${rebase(pattern.glob, dirs)}${quote}`,
  );
}

function analyzeService(label: string, service: SgNode, dirs: Directories): Analysis {
  const nothing: Analysis = { edits: [], findings: [] };
  const manual = (reason: string, node: SgNode): Analysis => ({
    edits: [],
    findings: [{ reason, node }],
  });
  const entries = objectEntries(service);
  if (entries.some((entry) => entryKey(entry) === null)) {
    return manual(`${label} has a spread or computed key`, service);
  }
  const filesEntry = entries.find((entry) => entryKey(entry) === "files");
  if (!filesEntry) return nothing;
  const files = filesEntry.kind() === "pair" ? pairValue(filesEntry) : null;
  if (files?.kind() !== "array") {
    return manual(`${label}.files is not an array literal`, filesEntry);
  }
  const fileElements = stringLiterals(files);
  if (!fileElements) {
    return manual(`${label}.files has an entry that is not a string literal`, filesEntry);
  }
  if (hasBackslash(fileElements)) {
    return manual(`${label}.files has a pattern written with a backslash`, filesEntry);
  }

  const filePatterns = fileElements.map((element) => parsePattern(element, true));
  const positives = filePatterns.filter((pattern) => !pattern.negated);
  if (positives.every((pattern) => path.isAbsolute(pattern.glob))) return nothing;
  const globFailure = ({ failed, error }: { failed: Pattern; error: unknown }) =>
    manual(`${label}.files could not be globbed: "${failed.glob}" (${String(error)})`, filesEntry);
  const fromConfigDir = globFrom(positives, dirs.configDir);
  if ("failed" in fromConfigDir) return globFailure(fromConfigDir);
  if (fromConfigDir.matched) return nothing;
  const fromProjectDir = globFrom(positives, dirs.projectDir);
  if ("failed" in fromProjectDir) return globFailure(fromProjectDir);
  if (!fromProjectDir.matched) {
    return manual(
      `${label}.files matches no files from this config's directory or from the project directory "${dirs.projectDir}"`,
      filesEntry,
    );
  }

  let ignoreElements: SgNode[] = [];
  const ignoresEntry = entries.find((entry) => entryKey(entry) === "ignores");
  if (ignoresEntry) {
    const elements = stringLiterals(
      ignoresEntry.kind() === "pair" ? pairValue(ignoresEntry) : null,
    );
    if (!elements) {
      return manual(`${label}.ignores is not an array of string literals`, ignoresEntry);
    }
    if (hasBackslash(elements)) {
      return manual(`${label}.ignores has a pattern written with a backslash`, ignoresEntry);
    }
    ignoreElements = elements;
  }

  return {
    edits: [...filePatterns, ...ignoreElements.map((element) => parsePattern(element, false))]
      .filter((pattern) => !path.isAbsolute(pattern.glob))
      .map((pattern) => rebaseEdit(pattern, dirs)),
    findings: [],
  };
}

/** The expression a module's own `export default` exports, or the local name it exports as default. */
function defaultExportTarget(root: SgNode): SgNode | string | null {
  for (const statement of root.children()) {
    if (statement.kind() !== "export_statement" || statement.field("source")) continue;
    const value = statement.field("value");
    if (value) return value.kind() === "identifier" ? value.text() : value;
    const specifier = statement
      .findAll({ rule: { kind: "export_specifier" } })
      .find((candidate) => candidate.field("alias")?.text() === "default");
    const name = specifier?.field("name")?.text();
    if (name) return name;
  }
  return null;
}

function topLevelValue(root: SgNode, name: string): SgNode | null {
  for (const statement of root.children()) {
    const declaration =
      statement.kind() === "export_statement" ? statement.field("declaration") : statement;
    if (
      declaration?.kind() !== "lexical_declaration" &&
      declaration?.kind() !== "variable_declaration"
    ) {
      continue;
    }
    const declarator = declaration
      .children()
      .find(
        (child) => child.kind() === "variable_declarator" && child.field("name")?.text() === name,
      );
    if (declarator) return declarator.field("value");
  }
  return null;
}

function isSameNode(a: SgNode, b: SgNode): boolean {
  return nodeRangeKey(a) === nodeRangeKey(b);
}

function analyzeCall(
  call: DefineConfigCalls["calls"][number],
  exported: SgNode | null,
  dirs: Directories,
): Analysis {
  const analysis = analyzeServiceConfigs([call], (label, service) =>
    analyzeService(label, service, dirs),
  );
  if ("reason" in call) return analysis;
  const exportedConfig = exported?.kind() === "call_expression" ? callArgument(exported) : null;
  if (exportedConfig && isSameNode(exportedConfig, call.config)) return analysis;
  if (analysis.edits.length === 0 && analysis.findings.length === 0) return analysis;
  return { edits: [], findings: [{ reason: NOT_THE_DEFAULT_EXPORT, node: call.config }] };
}

/** A module path or resolved specifier without its source extension or trailing `/index`. */
function moduleId(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
}

function isDefineConfigCall(source: string, filePath: string, node: SgNode): boolean {
  if (node.kind() !== "call_expression") return false;
  const argument = callArgument(node);
  const found = findDefineConfigCalls(source, filePath);
  return (
    found?.calls.some((call) =>
      "reason" in call
        ? isSameNode(call.node, node)
        : argument !== null && isSameNode(call.config, argument),
    ) ?? false
  );
}

/** The `[name, exported name]` pairs of an export statement's specifiers, leaving out types. */
function exportSpecifierNames(statement: SgNode): Array<[string, string]> {
  if (isTypeOnlyImport(statement)) return [];
  return statement.findAll({ rule: { kind: "export_specifier" } }).flatMap((specifier) => {
    const names = importSpecNames(specifier);
    return names && !names.typeOnly
      ? [[names.importedName, names.localName] as [string, string]]
      : [];
  });
}

/** The local names an import statement binds to any of `exportedNames`. */
function importedLocalNames(statement: SgNode, exportedNames: ReadonlySet<string>): string[] {
  if (statement.kind() !== "import_statement" || isTypeOnlyImport(statement)) return [];
  const clause = statement.children().find((child) => child.kind() === "import_clause");
  const names: string[] = [];
  for (const child of clause?.children() ?? []) {
    if (child.kind() === "identifier" && exportedNames.has("default")) names.push(child.text());
    if (child.kind() !== "named_imports") continue;
    for (const specifier of child.findAll({ rule: { kind: "import_specifier" } })) {
      const specifierNames = importSpecNames(specifier);
      if (
        specifierNames &&
        !specifierNames.typeOnly &&
        exportedNames.has(specifierNames.importedName)
      ) {
        names.push(specifierNames.localName);
      }
    }
  }
  return names;
}

/**
 * The names under which `file` exports the config that `carrier` exports: by
 * re-exporting it through a relative specifier, by exporting a binding it
 * imports from it, or, as `default`, by default-exporting a `defineConfig()`
 * call next to such an import.
 */
function configExportNames(source: string, file: string, carrier: ConfigCarrier): Set<string> {
  const exportNames = new Set<string>();
  const root = parseRoot(source, file);
  if (!root) return exportNames;
  const importedNames = new Set<string>();
  const localExports: Array<[string, string]> = [];
  for (const statement of root.children()) {
    const specifier = stringValue(statement.field("source"));
    if (statement.kind() === "export_statement" && specifier === null) {
      localExports.push(...exportSpecifierNames(statement));
      continue;
    }
    if (!specifier?.startsWith(".")) continue;
    if (moduleId(path.resolve(path.dirname(file), specifier)) !== carrier.id) continue;
    for (const [name, exportedName] of exportSpecifierNames(statement)) {
      if (carrier.names.has(name)) exportNames.add(exportedName);
    }
    for (const name of importedLocalNames(statement, carrier.names)) importedNames.add(name);
  }
  if (importedNames.size === 0) return exportNames;
  for (const [name, exportedName] of localExports) {
    if (importedNames.has(name)) exportNames.add(exportedName);
  }
  const target = defaultExportTarget(root);
  const value = typeof target === "string" ? topLevelValue(root, target) : target;
  if (typeof target === "string" && importedNames.has(target)) exportNames.add("default");
  if (value && isDefineConfigCall(source, file, value)) exportNames.add("default");
  return exportNames;
}

const sourceFilesByProject = new Map<string, Promise<SourceFile[]>>();

function projectSourceFiles(projectDir: string): Promise<SourceFile[]> {
  let files = sourceFilesByProject.get(projectDir);
  if (!files) {
    files = readSourceFiles(projectDir);
    sourceFilesByProject.set(projectDir, files);
  }
  return files;
}

async function readSourceFiles(projectDir: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for await (const relative of walkFiles(projectDir)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(relative))) continue;
    const file = path.resolve(projectDir, relative);
    try {
      files.push({ relative, file, source: await fs.promises.readFile(file, "utf-8") });
    } catch {
      continue;
    }
  }
  return files;
}

/**
 * The project-relative path of a source file outside `configFile`'s directory
 * that default-exports its config, following the modules that pass the config
 * on through relative specifiers.
 */
async function findConfigLoader(
  configFile: string,
  projectDir: string,
  exportedName: string | null,
): Promise<string | null> {
  const files = await projectSourceFiles(projectDir);
  const config: ConfigCarrier = {
    id: moduleId(configFile),
    names: new Set(exportedName ? ["default", exportedName] : ["default"]),
  };
  const carriers = [config];
  const visited = new Set([config.id]);
  for (const carrier of carriers) {
    const stem = path.basename(carrier.id);
    for (const { relative, file, source } of files) {
      if (!source.includes(stem)) continue;
      const names = configExportNames(source, file, carrier);
      if (names.has("default") && path.dirname(file) !== path.dirname(configFile)) return relative;
      const id = moduleId(file);
      if (names.size === 0 || visited.has(id)) continue;
      visited.add(id);
      carriers.push({ id, names });
    }
  }
  return null;
}

async function analyzeFile(
  source: string,
  filePath: string,
  projectDir: string,
): Promise<{ root: SgNode; analysis: Analysis } | null> {
  const dirs: Directories = { configDir: path.dirname(filePath), projectDir };
  if (dirs.configDir === projectDir) return null;
  const found = findDefineConfigCalls(source, filePath);
  if (!found) return null;
  const target = defaultExportTarget(found.root);
  const exportedName = typeof target === "string" ? target : null;
  const exported = typeof target === "string" ? topLevelValue(found.root, target) : target;
  const analysis: Analysis = { edits: [], findings: [] };
  for (const call of found.calls) {
    const result = analyzeCall(call, exported, dirs);
    const loader =
      result.edits.length > 0 ? await findConfigLoader(filePath, projectDir, exportedName) : null;
    if (loader && !("reason" in call)) {
      analysis.findings.push({
        reason: `\`${loader}\` ${LOADED_BY_ANOTHER_CONFIG}`,
        node: call.config,
      });
      continue;
    }
    analysis.edits.push(...result.edits);
    analysis.findings.push(...result.findings);
  }
  return { root: found.root, analysis };
}

/**
 * Rewrite the relative `files` and `ignores` patterns of a default-exported
 * config outside the project directory that match files only from the project
 * directory, so they name the same files relative to the config's own directory,
 * unless a source file in another directory default-exports the config.
 * @param source - File contents
 * @param filePath - Absolute path to the file being transformed
 * @param targetPath - Absolute project directory the codemod runs on
 * @returns Transformed source, or null when nothing matched
 */
export default async function transform(
  source: string,
  filePath: string,
  targetPath: string,
): Promise<string | null> {
  const result = await analyzeFile(source, filePath, targetPath);
  if (!result || result.analysis.edits.length === 0) return null;
  return result.root.commitEdits(result.analysis.edits);
}

/**
 * Report service configs outside the project directory whose patterns this
 * transform cannot rewrite, cannot glob, or that match no files from either
 * directory, `defineConfig()` calls other than the default export whose
 * patterns it would rewrite or report, and configs that a source file in
 * another directory default-exports.
 * @param source - File contents
 * @param filePath - Absolute path to the file being reviewed
 * @param relativePath - Project-relative path reported to the user
 * @param targetPath - Absolute project directory the codemod runs on
 * @returns Findings for configs needing a manual migration
 */
export async function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
  targetPath: string,
): Promise<LlmReviewFinding[]> {
  const result = await analyzeFile(source, filePath, targetPath);
  if (!result) return [];
  return result.analysis.findings.map((finding) => ({
    file: relativePath,
    line: lineOf(finding.node),
    message: `Rewrite the relative \`files\` and \`ignores\` patterns by hand so that they name their files relative to the directory of the config file the CLI loads: ${finding.reason}.`,
    excerpt: excerptOf(finding.node),
  }));
}
