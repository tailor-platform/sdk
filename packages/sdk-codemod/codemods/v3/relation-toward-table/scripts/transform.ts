import {
  callArgument,
  excerptOf,
  lineOf,
  pairValue,
  parseRoot,
  stringValue,
} from "../../../../src/ast-grep-helpers";
import {
  hasDynamicProperties,
  isRelationCall,
  objectPair,
  relationAliases,
} from "../../../../src/relation-call";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const LEGACY_KEY = "type";
const NEW_KEY = "table";

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
