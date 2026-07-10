import { parse, Lang } from "@ast-grep/napi";
import { stringValue } from "../../../../src/ast-grep-helpers";
import type { LlmReviewFinding } from "../../../../src/types";
import type { SgNode } from "@ast-grep/napi";

function sourceLang(filePath: string, source: string): Lang {
  const lowerPath = filePath.toLowerCase();
  if (/\.(?:ts|mts|cts)$/u.test(lowerPath)) return Lang.TypeScript;
  if (/\.(?:tsx|jsx)$/u.test(lowerPath)) return Lang.Tsx;
  return source.includes("</") ? Lang.Tsx : Lang.TypeScript;
}

function isRelationCall(call: SgNode, aliases: ReadonlySet<string>): boolean {
  const callee = call.children()[0];
  if (!callee) return false;
  if (callee.kind() === "identifier") return aliases.has(callee.text());
  if (callee.kind() === "subscript_expression") {
    return literalStringValue(callee.field("index")) === "relation";
  }
  if (callee.kind() !== "member_expression") return false;

  const property = callee
    .children()
    .findLast((child) => child.kind() === "property_identifier" || child.kind() === "identifier");
  return property?.text() === "relation";
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
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = declarator.field("name");
    if (!binding) continue;
    const name = relationBindingName(binding);
    if (name) aliases.add(name);
  }
  return aliases;
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

function needsReview(call: SgNode): boolean {
  const config = callArgument(call);
  if (config?.kind() !== "object") return config != null;
  if (hasDynamicProperties(config)) return true;

  const relationType = objectPair(config, "type");
  const toward = objectPair(config, "toward");
  if (!relationType || !toward) return false;
  if (literalStringValue(pairValue(relationType)) === "keyOnly") return false;

  const towardConfig = pairValue(toward);
  if (towardConfig?.kind() !== "object") return towardConfig != null;
  if (hasDynamicProperties(towardConfig)) return true;

  const as = objectPair(towardConfig, "as");
  if (as) {
    const explicitName = literalStringValue(pairValue(as));
    return explicitName === null || explicitName.length === 0;
  }

  const targetType = objectPair(towardConfig, "type");
  if (!targetType) return false;
  return literalStringValue(pairValue(targetType)) !== "self";
}

export default function transform(_source: string, _filePath: string): null {
  return null;
}

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (!source.includes("relation")) return [];

  const root = parse(sourceLang(filePath, source), source).root();
  const aliases = relationAliases(root);
  return root
    .findAll({ rule: { kind: "call_expression" } })
    .filter((call) => isRelationCall(call, aliases) && needsReview(call))
    .map((call) => ({
      file: relativePath,
      line: call.range().start.line + 1,
      message: "Review the v2 forward GraphQL field name or add an explicit toward.as.",
      excerpt: call.text().split("\n", 1)[0]!.trim(),
    }));
}
