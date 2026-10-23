import { stringValue } from "./ast-grep-helpers";
import type { SgNode } from "@ast-grep/napi";

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

export function relationAliases(root: SgNode): Set<string> {
  const aliases = new Set<string>();
  for (const pattern of root.findAll({ rule: { kind: "object_pattern" } })) {
    const name = relationBindingName(pattern);
    if (name) aliases.add(name);
  }
  return aliases;
}

export function isRelationCall(call: SgNode, aliases: ReadonlySet<string>): boolean {
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

function pairKey(pair: SgNode): string | null {
  const key = pair.children()[0];
  return stringValue(key ?? null);
}

export function objectPair(object: SgNode, key: string): SgNode | null {
  return (
    object.children().find((child) => child.kind() === "pair" && pairKey(child) === key) ?? null
  );
}

export function literalStringValue(node: SgNode | null): string | null {
  if (node?.kind() !== "string") return null;
  return stringValue(node);
}

export function hasDynamicProperties(object: SgNode): boolean {
  return object.children().some((child) => {
    const kind = child.kind();
    if (kind === "{" || kind === "}" || kind === "," || kind === "comment") return false;
    if (kind !== "pair") return true;

    const keyKind = child.children()[0]?.kind();
    return keyKind !== "property_identifier" && keyKind !== "string";
  });
}
