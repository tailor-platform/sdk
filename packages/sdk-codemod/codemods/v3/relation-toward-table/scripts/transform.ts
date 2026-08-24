import { parse, Lang } from "@ast-grep/napi";
import { stringValue } from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const LEGACY_KEY = "type";
const NEW_KEY = "table";

function sourceLang(filePath: string, source: string): Lang {
  const lowerPath = filePath.toLowerCase();
  if (/\.(?:ts|mts|cts)$/u.test(lowerPath)) return Lang.TypeScript;
  if (/\.(?:tsx|jsx|js)$/u.test(lowerPath)) return Lang.Tsx;
  return source.includes("</") ? Lang.Tsx : Lang.TypeScript;
}

function relationBindingName(pattern: SgNode): string | null {
  if (pattern.kind() !== "object_pattern") return null;

  for (const child of pattern.children()) {
    if (child.kind() === "shorthand_property_identifier_pattern" && child.text() === "relation") {
      return child.text();
    }
    if (child.kind() === "pair_pattern" && stringValue(child.field("key")) === "relation") {
      const value = child.field("value");
      return value?.kind() === "identifier" ? value.text() : null;
    }
    if (child.kind() === "object_assignment_pattern") {
      const binding = child
        .children()
        .find((node) => node.kind() === "shorthand_property_identifier_pattern");
      if (binding?.text() === "relation") return binding.text();
    }
  }

  return null;
}

function relationAliases(root: SgNode): Set<string> {
  const aliases = new Set<string>();
  for (const pattern of root.findAll({ rule: { kind: "object_pattern" } })) {
    const name = relationBindingName(pattern);
    if (name) aliases.add(name);
  }
  return aliases;
}

function isRelationCall(call: SgNode, aliases: ReadonlySet<string>): boolean {
  const callee = call.children()[0];
  if (!callee) return false;
  if (callee.kind() === "identifier") return aliases.has(callee.text());
  if (callee.kind() === "subscript_expression") {
    const property = literalStringValue(callee.field("index"));
    return property === null || property === "relation";
  }
  if (callee.kind() !== "member_expression") return false;

  const property = callee
    .children()
    .findLast((child) => child.kind() === "property_identifier" || child.kind() === "identifier");
  return property?.text() === "relation";
}

function callArgument(call: SgNode): SgNode | null {
  const args = call.children().find((child) => child.kind() === "arguments");
  if (!args) return null;

  const values = args.children().filter((child) => {
    const kind = child.kind();
    return kind !== "(" && kind !== ")" && kind !== "," && kind !== "comment";
  });
  return values.length === 1 ? values[0]! : null;
}

function pairKey(pair: SgNode): string | null {
  const key = pair.children()[0];
  return stringValue(key ?? null);
}

function pairValue(pair: SgNode): SgNode | null {
  const children = pair.children();
  const colonIndex = children.findIndex((child) => child.kind() === ":");
  if (colonIndex === -1) return null;
  return children.slice(colonIndex + 1).find((child) => child.kind() !== "comment") ?? null;
}

function objectPair(object: SgNode, key: string): SgNode | null {
  return (
    object.children().find((child) => child.kind() === "pair" && pairKey(child) === key) ?? null
  );
}

function literalStringValue(node: SgNode | null): string | null {
  if (node?.kind() !== "string") return null;
  return stringValue(node);
}

function hasDynamicProperties(object: SgNode): boolean {
  return object.children().some((child) => {
    const kind = child.kind();
    if (kind === "{" || kind === "}" || kind === "," || kind === "comment") return false;
    if (kind !== "pair") return true;

    const keyKind = child.children()[0]?.kind();
    return keyKind !== "property_identifier" && keyKind !== "string";
  });
}

/**
 * Same as {@link hasDynamicProperties}, but for a `toward` object
 * specifically: a bare `{ type }` shorthand is a safe, rewritable spelling
 * (only the key moves, matching `renameEdit`'s shorthand handling), not a
 * sign of an unsafe/computed key.
 */
function hasUnsafeTowardProperties(towardObject: SgNode): boolean {
  return towardObject.children().some((child) => {
    const kind = child.kind();
    if (kind === "{" || kind === "}" || kind === "," || kind === "comment") return false;
    if (kind === "shorthand_property_identifier") return false;
    if (kind !== "pair") return true;

    const keyKind = child.children()[0]?.kind();
    return keyKind !== "property_identifier" && keyKind !== "string";
  });
}

/** A `toward.type` entry found on a `.relation()` call's `toward` object. */
type LegacyEntry = {
  /** The key node to rewrite, or the shorthand node standing in for key and value. */
  node: SgNode;
  /** Whether the entry is `{ type }` rather than `{ type: ... }`. */
  shorthand: boolean;
};

function findLegacyEntry(towardObject: SgNode): LegacyEntry | null {
  for (const child of towardObject.children()) {
    if (child.kind() === "shorthand_property_identifier" && child.text() === LEGACY_KEY) {
      return { node: child, shorthand: true };
    }
    if (child.kind() !== "pair") continue;
    const key = child.children()[0];
    if (!key) continue;
    if (key.kind() !== "property_identifier" && key.kind() !== "string") continue;
    if (stringValue(key) !== LEGACY_KEY) continue;
    return { node: key, shorthand: false };
  }
  return null;
}

function renameEdit(entry: LegacyEntry): Edit {
  if (entry.shorthand) {
    // `{ type }` reads a local of that name, so only the key moves.
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

/**
 * Rename `.relation()`'s `toward.type` option to `toward.table`.
 * @param source - File contents
 * @param filePath - Path to the file being transformed
 * @returns Transformed source, or null when nothing matched
 */
export default function transform(source: string, filePath = ""): string | null {
  if (!source.includes("relation")) return null;

  const root = parseRoot(source, filePath);
  if (!root) return null;

  const aliases = relationAliases(root);
  const edits: Edit[] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (!isRelationCall(call, aliases)) continue;
    const config = callArgument(call);
    if (config?.kind() !== "object") continue;
    if (hasDynamicProperties(config)) continue;

    // Both a cardinality `type` and a `toward` are required for this to be a
    // real relation config, not an unrelated `.relation()` method elsewhere.
    if (!objectPair(config, "type")) continue;
    const toward = objectPair(config, "toward");
    if (!toward) continue;
    const towardConfig = pairValue(toward);
    if (towardConfig?.kind() !== "object") continue;
    if (hasUnsafeTowardProperties(towardConfig)) continue;
    // A `table` key already present alongside `type` means rewriting `type`
    // to `table` would produce a duplicate key; leave it for manual review.
    if (objectPair(towardConfig, NEW_KEY)) continue;

    const entry = findLegacyEntry(towardConfig);
    if (!entry) continue;
    edits.push(renameEdit(entry));
  }

  return edits.length > 0 ? root.commitEdits(edits) : null;
}

function lineOf(node: SgNode): number {
  return node.range().start.line + 1;
}

function excerptOf(node: SgNode): string {
  return node.text().split("\n", 1)[0]!.trim();
}

/**
 * Report `.relation()` calls this transform cannot safely rewrite: a
 * non-object call argument, a computed/spread key on the config or `toward`
 * object, or a `toward` reached through something other than a literal
 * object (e.g. a shared variable).
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
  if (!source.includes("relation")) return [];

  const root = parseRoot(source, filePath);
  if (!root) return [];

  const aliases = relationAliases(root);
  const findings: LlmReviewFinding[] = [];

  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    if (!isRelationCall(call, aliases)) continue;
    const config = callArgument(call);
    if (config?.kind() !== "object") {
      if (config) {
        findings.push({
          file: relativePath,
          line: lineOf(call),
          message:
            "This .relation() call's config isn't a literal object; check its toward.type manually.",
          excerpt: excerptOf(call),
        });
      }
      continue;
    }
    if (hasDynamicProperties(config)) {
      findings.push({
        file: relativePath,
        line: lineOf(config),
        message: "A computed/spread key on this .relation() config may hide toward.type.",
        excerpt: excerptOf(config),
      });
      continue;
    }

    const toward = objectPair(config, "toward");
    if (!toward) continue;
    const towardConfig = pairValue(toward);
    if (towardConfig?.kind() !== "object") {
      findings.push({
        file: relativePath,
        line: lineOf(toward),
        message:
          "This .relation() call's toward isn't a literal object; rename type to table by hand.",
        excerpt: excerptOf(toward),
      });
      continue;
    }
    if (hasUnsafeTowardProperties(towardConfig)) {
      findings.push({
        file: relativePath,
        line: lineOf(towardConfig),
        message: "A computed/spread key on this toward object may hide type.",
        excerpt: excerptOf(towardConfig),
      });
      continue;
    }
    if (objectPair(towardConfig, NEW_KEY) && findLegacyEntry(towardConfig)) {
      findings.push({
        file: relativePath,
        line: lineOf(towardConfig),
        message:
          "This toward object has both table and type; remove the deprecated type by hand instead of automatically renaming it (would produce a duplicate key).",
        excerpt: excerptOf(towardConfig),
      });
    }
  }

  return findings;
}
