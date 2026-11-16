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
import { nodeRangeKey, sourceStringContent } from "../../../../src/source-strings";
import { SOURCE_EXTENSIONS, walkFiles } from "../../../../src/walk-files";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const NOT_THE_DEFAULT_EXPORT =
  "this defineConfig() call is not the module's default export, so its patterns resolve against the directory of the config file that loads it";

/** The config file's directory, and the project directory commands are assumed to run from. */
type Directories = { configDir: string; projectDir: string };

/** A module, by `moduleId`, and the names under which it exports the config. */
type ConfigCarrier = { id: string; names: ReadonlySet<string> };

/** A name a module exports, the local binding it exports, if any, and the value exported. */
type LocalExport = { name: string; local: string | null; value: SgNode | null };

type DefineConfigCall = DefineConfigCalls["calls"][number];

/** A project source file, by its project-relative and absolute paths, with its contents. */
type SourceFile = { relative: string; file: string; source: string };

/**
 * The names under which a module exports the config a carrier exports, and
 * whether it takes the carrier as a namespace while exporting a value.
 */
type CarriedConfig = { names: Set<string>; takesNamespace: boolean };

/**
 * The source files that default-export a config, and those that take it as a
 * namespace, which the loader search does not follow.
 */
type ConfigLoaders = { loaders: SourceFile[]; namespaceImporters: SourceFile[] };

/** The pattern of a `files` or `ignores` entry without its quotes, with any leading `!` split off. */
type Pattern = { node: SgNode; negated: boolean; glob: string };

/** Whether any pattern matched a file, or the pattern whose glob threw. */
type GlobResult = { matched: boolean } | { failed: Pattern; error: unknown };

function parsePattern(node: SgNode, source: string, negatable: boolean): Pattern {
  const value = sourceStringContent(node, source) ?? "";
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

function literalPatterns(array: SgNode | null, source: string): SgNode[] | null {
  if (array?.kind() !== "array") return null;
  const elements = arrayElements(array);
  return elements.every((element) => sourceStringContent(element, source) !== null)
    ? elements
    : null;
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

function analyzeService(
  source: string,
  label: string,
  service: SgNode,
  dirs: Directories,
): Analysis {
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
  const fileElements = literalPatterns(files, source);
  if (!fileElements) {
    return manual(`${label}.files has an entry that is not a string literal`, filesEntry);
  }
  if (hasBackslash(fileElements)) {
    return manual(`${label}.files has a pattern written with a backslash`, filesEntry);
  }

  const filePatterns = fileElements.map((element) => parsePattern(element, source, true));
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
    const elements = literalPatterns(
      ignoresEntry.kind() === "pair" ? pairValue(ignoresEntry) : null,
      source,
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
    edits: [
      ...filePatterns,
      ...ignoreElements.map((element) => parsePattern(element, source, false)),
    ]
      .filter((pattern) => !path.isAbsolute(pattern.glob))
      .map((pattern) => rebaseEdit(pattern, dirs)),
    findings: [],
  };
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

/** Each name a module's own export statements export. */
function localExports(root: SgNode): LocalExport[] {
  const entries: LocalExport[] = [];
  for (const statement of root.children()) {
    if (statement.kind() !== "export_statement" || statement.field("source")) continue;
    const value = statement.field("value");
    if (value) {
      const local = value.kind() === "identifier" ? value.text() : null;
      entries.push({ name: "default", local, value: local ? topLevelValue(root, local) : value });
      continue;
    }
    for (const declarator of statement.field("declaration")?.children() ?? []) {
      const name = declarator.kind() === "variable_declarator" ? declarator.field("name") : null;
      if (name?.kind() !== "identifier") continue;
      entries.push({ name: name.text(), local: name.text(), value: declarator.field("value") });
    }
    for (const [local, name] of exportSpecifierNames(statement)) {
      entries.push({ name, local, value: topLevelValue(root, local) });
    }
  }
  return entries;
}

function isSameNode(a: SgNode, b: SgNode): boolean {
  return nodeRangeKey(a) === nodeRangeKey(b);
}

function isCallOf(value: SgNode | null, call: DefineConfigCall): boolean {
  if (value?.kind() !== "call_expression") return false;
  if ("reason" in call) return isSameNode(value, call.node);
  const argument = callArgument(value);
  return argument !== null && isSameNode(argument, call.config);
}

function analyzeFrom(source: string, call: DefineConfigCall, dirs: Directories): Analysis {
  return analyzeServiceConfigs([call], (label, service) =>
    analyzeService(source, label, service, dirs),
  );
}

function isEmpty(analysis: Analysis): boolean {
  return analysis.edits.length === 0 && analysis.findings.length === 0;
}

/** A module path or resolved specifier without its source extension or trailing `/index`. */
function moduleId(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
}

function isDefineConfigCall(source: string, filePath: string, node: SgNode): boolean {
  return (
    findDefineConfigCalls(source, filePath)?.calls.some((call) => isCallOf(node, call)) ?? false
  );
}

/** Whether a statement is type-only, including `export type *`, which parses with `type` in an ERROR node. */
function isTypeOnlyStatement(statement: SgNode): boolean {
  return (
    isTypeOnlyImport(statement) ||
    statement.children().some((child) => child.kind() === "ERROR" && child.text() === "type")
  );
}

/** Whether a statement re-exports every name of its source but `default`, as `export * from` does. */
function isStarExport(statement: SgNode): boolean {
  return (
    statement.kind() === "export_statement" &&
    statement.children().some((child) => child.kind() === "*")
  );
}

/** The `[name, exported name]` pairs of an export statement's specifiers, leaving out types. */
function exportSpecifierNames(statement: SgNode): Array<[string, string]> {
  if (isTypeOnlyStatement(statement)) return [];
  return statement.findAll({ rule: { kind: "export_specifier" } }).flatMap((specifier) => {
    const names = importSpecNames(specifier);
    return names && !names.typeOnly
      ? [[names.importedName, names.localName] as [string, string]]
      : [];
  });
}

/** The local names an import statement binds to any of `exportedNames`. */
function importedLocalNames(statement: SgNode, exportedNames: ReadonlySet<string>): string[] {
  if (statement.kind() !== "import_statement") return [];
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

function exportsValue(statement: SgNode): boolean {
  if (statement.kind() !== "export_statement" || isTypeOnlyStatement(statement)) return false;
  const declaration = statement.field("declaration")?.kind();
  if (declaration === "type_alias_declaration" || declaration === "interface_declaration") {
    return false;
  }
  const specifiers = statement.findAll({ rule: { kind: "export_specifier" } });
  return (
    specifiers.length === 0 || specifiers.some((specifier) => !importSpecNames(specifier)?.typeOnly)
  );
}

function isCarrierSpecifier(
  specifier: string | null,
  file: string,
  carrier: ConfigCarrier,
): boolean {
  return (
    specifier?.startsWith(".") === true &&
    moduleId(path.resolve(path.dirname(file), specifier)) === carrier.id
  );
}

/**
 * How `sourceFile` passes on the config that `carrier` exports: the names it
 * exports it under, by re-exporting it through a relative specifier, including
 * with `export *`, by exporting a binding it imports from it, or, as `default`,
 * by default-exporting a `defineConfig()` call next to such an import; and
 * whether it takes the carrier as a namespace with `import * as`,
 * `export * as`, or `import()` while exporting a value.
 */
function carriedConfig(sourceFile: SourceFile, carrier: ConfigCarrier): CarriedConfig {
  const { source, file } = sourceFile;
  const exportNames = new Set<string>();
  const root = parsedRoot(sourceFile);
  if (!root) return { names: exportNames, takesNamespace: false };
  const importedNames = new Set<string>();
  let takesNamespace = root
    .findAll({ rule: { pattern: "import($SPECIFIER)" } })
    .some((call) => isCarrierSpecifier(stringValue(call.getMatch("SPECIFIER")), file, carrier));
  for (const statement of root.children()) {
    if (isTypeOnlyStatement(statement)) continue;
    if (!isCarrierSpecifier(stringValue(statement.field("source")), file, carrier)) continue;
    if (
      statement.find({
        rule: { any: [{ kind: "namespace_import" }, { kind: "namespace_export" }] },
      })
    ) {
      takesNamespace = true;
    }
    if (isStarExport(statement)) {
      for (const name of carrier.names) if (name !== "default") exportNames.add(name);
    }
    for (const [name, exportedName] of exportSpecifierNames(statement)) {
      if (carrier.names.has(name)) exportNames.add(exportedName);
    }
    for (const name of importedLocalNames(statement, carrier.names)) importedNames.add(name);
  }
  for (const { name, local, value } of importedNames.size > 0 ? localExports(root) : []) {
    if (local !== null && importedNames.has(local)) exportNames.add(name);
    if (name === "default" && value && isDefineConfigCall(source, file, value)) {
      exportNames.add("default");
    }
  }
  return {
    names: exportNames,
    takesNamespace: takesNamespace && root.children().some(exportsValue),
  };
}

const sourceFilesByProject = new Map<string, Promise<SourceFile[]>>();
const parsedRoots = new WeakMap<SourceFile, SgNode | null>();

function parsedRoot(sourceFile: SourceFile): SgNode | null {
  if (!parsedRoots.has(sourceFile)) {
    parsedRoots.set(sourceFile, parseRoot(sourceFile.source, sourceFile.file));
  }
  return parsedRoots.get(sourceFile) ?? null;
}

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
 * The source files outside `configFile`'s directory that default-export the
 * config it exports under `exportNames`, and the other source files that take
 * it as a namespace, following the modules that pass the config on through
 * relative specifiers, each in path order.
 */
async function findConfigLoaders(
  configFile: string,
  projectDir: string,
  exportNames: ReadonlySet<string>,
): Promise<ConfigLoaders> {
  const files = await projectSourceFiles(projectDir);
  const config: ConfigCarrier = { id: moduleId(configFile), names: exportNames };
  const carriers = [config];
  const namesById = new Map([[config.id, exportNames]]);
  const loaders = new Set<SourceFile>();
  const namespaceImporters = new Set<SourceFile>();
  for (const carrier of carriers) {
    const stem = path.basename(carrier.id);
    for (const sourceFile of files) {
      if (!sourceFile.source.includes(stem)) continue;
      const { names, takesNamespace } = carriedConfig(sourceFile, carrier);
      if (names.has("default") && path.dirname(sourceFile.file) !== path.dirname(configFile)) {
        loaders.add(sourceFile);
      }
      if (takesNamespace) namespaceImporters.add(sourceFile);
      const id = moduleId(sourceFile.file);
      const known = namesById.get(id);
      const added = known ? names.difference(known) : names;
      if (added.size === 0) continue;
      namesById.set(id, known ? known.union(added) : added);
      carriers.push({ id, names: added });
    }
  }
  const byPath = (a: SourceFile, b: SourceFile) => (a.relative < b.relative ? -1 : 1);
  return {
    loaders: [...loaders].toSorted(byPath),
    namespaceImporters: [...namespaceImporters.difference(loaders)].toSorted(byPath),
  };
}

function fileList(files: SourceFile[]): string {
  return files.map(({ relative }) => `\`${relative}\``).join(", ");
}

function loadedBy({ loaders, namespaceImporters }: ConfigLoaders): string {
  const reasons: string[] = [];
  if (loaders.length === 1) {
    reasons.push(
      `${fileList(loaders)} loads this config, so its patterns resolve against that file's directory when the CLI loads it`,
    );
  } else if (loaders.length > 1) {
    reasons.push(
      `${fileList(loaders)} load this config, so its patterns resolve against the directory of whichever of them the CLI loads`,
    );
  }
  if (namespaceImporters.length > 0) {
    const verb = namespaceImporters.length === 1 ? "imports or re-exports" : "import or re-export";
    reasons.push(
      `${fileList(namespaceImporters)} ${verb} this config through a namespace, which this codemod does not follow, so check which config file the CLI loads it through`,
    );
  }
  return reasons.join("; ");
}

async function analyzeFile(
  source: string,
  filePath: string,
  projectDir: string,
): Promise<{ root: SgNode; analysis: Analysis } | null> {
  const configDir = path.dirname(filePath);
  if (configDir === projectDir) return null;
  const found = findDefineConfigCalls(source, filePath);
  if (!found) return null;
  const moduleExports = localExports(found.root);
  const analysis: Analysis = { edits: [], findings: [] };
  for (const call of found.calls) {
    const node = "reason" in call ? call.node : call.config;
    const exportNames = new Set(
      moduleExports.filter(({ value }) => isCallOf(value, call)).map(({ name }) => name),
    );
    const configLoaders =
      exportNames.size > 0
        ? await findConfigLoaders(filePath, projectDir, exportNames)
        : { loaders: [], namespaceImporters: [] };
    const { loaders, namespaceImporters } = configLoaders;
    if (loaders.length > 0 || namespaceImporters.length > 0) {
      const loadingDirs = [...loaders, ...namespaceImporters]
        .map(({ file }) => path.dirname(file))
        .filter((dir) => dir !== projectDir);
      if (loaders.length === 0) loadingDirs.push(configDir);
      const affected = loadingDirs.some(
        (dir) => !isEmpty(analyzeFrom(source, call, { configDir: dir, projectDir })),
      );
      if (affected) analysis.findings.push({ reason: loadedBy(configLoaders), node });
      continue;
    }
    const result = analyzeFrom(source, call, { configDir, projectDir });
    if ("reason" in call || exportNames.has("default")) {
      analysis.edits.push(...result.edits);
      analysis.findings.push(...result.findings);
    } else if (!isEmpty(result)) {
      analysis.findings.push({ reason: NOT_THE_DEFAULT_EXPORT, node });
    }
  }
  return { root: found.root, analysis };
}

/**
 * Rewrite the relative `files` and `ignores` patterns of a default-exported
 * config outside the project directory that match files only from the project
 * directory, so they name the same files relative to the config's own directory,
 * unless a source file in another directory default-exports the config or a
 * module that exports a value takes it as a namespace.
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
 * patterns it would rewrite or report, configs that a source file outside both
 * the config's directory and the project directory default-exports when their
 * patterns would need a rewrite or a report from that file's directory, and
 * configs that a module that exports a value takes as a namespace when their
 * patterns would need a rewrite or a report from its directory, unless it is the
 * project directory, or, when no source file default-exports them, from their own.
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
