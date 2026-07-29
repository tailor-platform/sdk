import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  importSource,
  isTypeOnlyImport,
  localDeclarationNames,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const SDK_MODULE = "@tailor-platform/sdk";
const DEFINE_IDP = "defineIdp";
const LEGACY_KEY = "publishUserEvents";
const NEW_KEY = "publishEvents";

function sourceLang(filePath: string, source: string): Lang {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") || source.includes("</")
    ? Lang.Tsx
    : Lang.TypeScript;
}

type DefineIdpNames = {
  /** Local names bound to the SDK's `defineIdp` export. */
  direct: Set<string>;
  /** Local names bound to a namespace import of the SDK. */
  namespaces: Set<string>;
};

function collectDefineIdpNames(root: SgNode): DefineIdpNames {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const importStmt of findImportStatements(root)) {
    if (importSource(importStmt) !== SDK_MODULE || isTypeOnlyImport(importStmt)) continue;
    for (const binding of importBindings(importStmt)) {
      if (binding.importedName === DEFINE_IDP) direct.add(binding.localName);
    }
    for (const namespaceImport of importStmt.findAll({ rule: { kind: "namespace_import" } })) {
      for (const identifier of namespaceImport.children()) {
        if (identifier.kind() === "identifier") namespaces.add(identifier.text());
      }
    }
  }
  return { direct, namespaces };
}

function memberProperty(member: SgNode): SgNode | null {
  return (
    member
      .children()
      .findLast(
        (child) => child.kind() === "property_identifier" || child.kind() === "identifier",
      ) ?? null
  );
}

function isDefineIdpCall(call: SgNode, names: DefineIdpNames): boolean {
  const callee = call.children()[0];
  if (!callee) return false;
  if (callee.kind() === "identifier") return names.direct.has(callee.text());
  if (callee.kind() !== "member_expression") return false;
  const object = callee.field("object");
  return (
    object?.kind() === "identifier" &&
    names.namespaces.has(object.text()) &&
    memberProperty(callee)?.text() === DEFINE_IDP
  );
}

function objectArguments(call: SgNode): SgNode[] {
  const args = call.children().find((child) => child.kind() === "arguments");
  if (!args) return [];
  return args.children().filter((child) => child.kind() === "object");
}

/** A `publishUserEvents` entry found directly on a `defineIdp` options object. */
type LegacyEntry = {
  /** The key node to rewrite, or the shorthand node standing in for key and value. */
  node: SgNode;
  /** Whether the entry is `{ publishUserEvents }` rather than `{ publishUserEvents: ... }`. */
  shorthand: boolean;
};

function findLegacyEntries(object: SgNode): LegacyEntry[] {
  const entries: LegacyEntry[] = [];
  for (const child of object.children()) {
    if (child.kind() === "shorthand_property_identifier" && child.text() === LEGACY_KEY) {
      entries.push({ node: child, shorthand: true });
      continue;
    }
    if (child.kind() !== "pair") continue;
    const key = child.children()[0];
    if (!key) continue;
    if (key.kind() !== "property_identifier" && key.kind() !== "string") continue;
    if (stringValue(key) !== LEGACY_KEY) continue;
    entries.push({ node: key, shorthand: false });
  }
  return entries;
}

function renameEdit(entry: LegacyEntry): Edit {
  if (entry.shorthand) {
    // `{ publishUserEvents }` reads a local of that name, so only the key moves.
    return entry.node.replace(`${NEW_KEY}: ${LEGACY_KEY}`);
  }
  const text = entry.node.text();
  if (entry.node.kind() !== "string") return entry.node.replace(NEW_KEY);
  const quote = text.startsWith("'") ? "'" : text.startsWith("`") ? "`" : '"';
  return entry.node.replace(`${quote}${NEW_KEY}${quote}`);
}

function parseRoot(source: string, filePath: string): SgNode | null {
  try {
    return parse(sourceLang(filePath, source), source).root();
  } catch {
    return null;
  }
}

function shadowsDefineIdp(root: SgNode, names: DefineIdpNames): boolean {
  const declared = localDeclarationNames(root);
  return [...names.direct, ...names.namespaces].some((name) => declared.has(name));
}

/**
 * Rename the `publishUserEvents` option to `publishEvents` on `defineIdp` calls.
 * @param source - File contents
 * @param filePath - Path to the file being transformed
 * @returns Transformed source, or null when nothing matched
 */
export default function transform(source: string, filePath = ""): string | null {
  if (!source.includes(LEGACY_KEY) || !source.includes(SDK_MODULE)) return null;

  const root = parseRoot(source, filePath);
  if (!root) return null;

  const names = collectDefineIdpNames(root);
  if (names.direct.size === 0 && names.namespaces.size === 0) return null;
  // A local of the same name may not be the SDK export; leave the file for review.
  if (shadowsDefineIdp(root, names)) return null;

  const edits: Edit[] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (!isDefineIdpCall(call, names)) continue;
    for (const object of objectArguments(call)) {
      for (const entry of findLegacyEntries(object)) {
        edits.push(renameEdit(entry));
      }
    }
  }

  return edits.length > 0 ? root.commitEdits(edits) : null;
}

function lineOf(node: SgNode): number {
  return node.range().start.line + 1;
}

function excerptOf(node: SgNode): string {
  return node.text().split("\n", 1)[0]!.trim();
}

type Range = { start: number; end: number };

function coversIndex(ranges: ReadonlyArray<Range>, index: number): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/** Computed keys whose value cannot be read statically, e.g. `[key]: value`. */
function computedKeyEntries(object: SgNode): SgNode[] {
  return object
    .children()
    .filter((child) => child.kind() === "pair")
    .flatMap((pair) => {
      const key = pair.children()[0];
      return key?.kind() === "computed_property_name" ? [key] : [];
    });
}

/**
 * Report `publishUserEvents` occurrences the transform cannot rewrite.
 *
 * Occurrences nested deeper inside a `defineIdp` options object belong to a
 * different option shape (e.g. `userAuthPolicy`) and are left alone, so only
 * what the transform genuinely missed is reported.
 * @param source - File contents
 * @param filePath - Path to the file being reviewed
 * @param relativePath - Repository-relative path reported to the user
 * @returns Findings for occurrences needing a manual rename
 */
export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!source.includes(LEGACY_KEY) || !source.includes(SDK_MODULE)) return [];

  const root = parseRoot(source, filePath);
  if (!root) return [];

  const names = collectDefineIdpNames(root);
  const hasDefineIdp = names.direct.size > 0 || names.namespaces.size > 0;
  if (hasDefineIdp && shadowsDefineIdp(root, names)) {
    return [
      {
        file: relativePath,
        line: 1,
        message: `A local declaration shadows the SDK ${DEFINE_IDP} import; rename ${LEGACY_KEY} to ${NEW_KEY} by hand.`,
        excerpt: LEGACY_KEY,
      },
    ];
  }

  const rewritten = new Set<number>();
  const optionRanges: Range[] = [];
  const findings: LlmReviewFinding[] = [];
  if (hasDefineIdp) {
    for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
      if (!isDefineIdpCall(call, names)) continue;
      for (const object of objectArguments(call)) {
        const range = object.range();
        optionRanges.push({ start: range.start.index, end: range.end.index });
        for (const entry of findLegacyEntries(object)) {
          rewritten.add(entry.node.range().start.index);
        }
        for (const key of computedKeyEntries(object)) {
          findings.push({
            file: relativePath,
            line: lineOf(key),
            message: `A computed ${DEFINE_IDP} option key may be ${LEGACY_KEY}; rename it to ${NEW_KEY} if so.`,
            excerpt: excerptOf(key),
          });
        }
      }
    }
  }

  // A type declaration's key is a property_identifier too, so this one rule
  // covers object literals, shorthand entries, and property signatures alike.
  for (const node of root.findAll({
    rule: {
      any: [
        { kind: "property_identifier", regex: `^${LEGACY_KEY}$` },
        { kind: "shorthand_property_identifier", regex: `^${LEGACY_KEY}$` },
      ],
    },
  })) {
    const index = node.range().start.index;
    // Rewritten already, or a nested key belonging to another option shape.
    if (rewritten.has(index) || coversIndex(optionRanges, index)) continue;
    findings.push({
      file: relativePath,
      line: lineOf(node),
      message: `Rename the IdP option ${LEGACY_KEY} to ${NEW_KEY}.`,
      excerpt: excerptOf(node),
    });
  }
  return findings;
}
