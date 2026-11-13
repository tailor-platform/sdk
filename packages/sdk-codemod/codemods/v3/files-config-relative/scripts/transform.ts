import * as fs from "node:fs";
import * as path from "pathe";
import {
  arrayElements,
  entryKey,
  excerptOf,
  lineOf,
  objectEntries,
  pairValue,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import {
  analyzeServiceConfigs,
  findDefineConfigCalls,
  type Analysis,
} from "../../../../src/define-config";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const NOT_A_CONFIG_MODULE =
  "this module does not default-export a config, so its patterns resolve against the directory of the config file that loads it";

/** The config file's directory, and the project directory commands are assumed to run from. */
type Directories = { configDir: string; projectDir: string };

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
  return glob.startsWith("./") && !leavesConfigDir ? `./${rebased}` : rebased;
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
      `${label}.files matches no files from this config's directory or from the project directory`,
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

function isDefaultExport(statement: SgNode): boolean {
  if (statement.kind() !== "export_statement") return false;
  if (statement.children().some((child) => child.kind() === "default")) return true;
  return statement
    .findAll({ rule: { kind: "export_specifier" } })
    .some((specifier) => specifier.children().at(-1)?.text() === "default");
}

function analyzeFile(
  source: string,
  filePath: string,
  projectDir: string,
): { root: SgNode; analysis: Analysis } | null {
  const dirs: Directories = { configDir: path.dirname(filePath), projectDir };
  if (dirs.configDir === projectDir) return null;
  const found = findDefineConfigCalls(source, filePath);
  if (!found) return null;
  const calls = found.root.children().some(isDefaultExport)
    ? found.calls
    : found.calls.map((call) =>
        "reason" in call ? call : { reason: NOT_A_CONFIG_MODULE, node: call.config },
      );
  return {
    root: found.root,
    analysis: analyzeServiceConfigs(calls, (label, service) =>
      analyzeService(label, service, dirs),
    ),
  };
}

/**
 * Rewrite the relative `files` and `ignores` patterns of a config outside the
 * project directory that match files only from the project directory, so they
 * name the same files relative to the config's own directory.
 * @param source - File contents
 * @param filePath - Absolute path to the file being transformed
 * @param targetPath - Absolute project directory the codemod runs on
 * @returns Transformed source, or null when nothing matched
 */
export default function transform(
  source: string,
  filePath: string,
  targetPath: string,
): string | null {
  const result = analyzeFile(source, filePath, targetPath);
  if (!result || result.analysis.edits.length === 0) return null;
  return result.root.commitEdits(result.analysis.edits);
}

/**
 * Report service configs outside the project directory whose patterns this
 * transform cannot rewrite, cannot glob, or that match no files from either directory.
 * @param source - File contents
 * @param filePath - Absolute path to the file being reviewed
 * @param relativePath - Project-relative path reported to the user
 * @param targetPath - Absolute project directory the codemod runs on
 * @returns Findings for configs needing a manual migration
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
  targetPath: string,
): LlmReviewFinding[] {
  const result = analyzeFile(source, filePath, targetPath);
  if (!result) return [];
  return result.analysis.findings.map((finding) => ({
    file: relativePath,
    line: lineOf(finding.node),
    message: `Make the relative \`files\` and \`ignores\` patterns relative to this config's directory by hand: ${finding.reason}.`,
    excerpt: excerptOf(finding.node),
  }));
}
