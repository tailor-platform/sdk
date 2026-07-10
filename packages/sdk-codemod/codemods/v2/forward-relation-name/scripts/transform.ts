import { parse, Lang } from "@ast-grep/napi";
import type { LlmReviewFinding } from "../../../../src/types";
import type { SgNode } from "@ast-grep/napi";

function sourceLang(filePath: string, source: string): Lang {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") || source.includes("</")
    ? Lang.Tsx
    : Lang.TypeScript;
}

function isRelationCall(call: SgNode): boolean {
  const callee = call.children()[0];
  if (callee?.kind() !== "member_expression") return false;

  const property = callee
    .children()
    .findLast((child) => child.kind() === "property_identifier" || child.kind() === "identifier");
  return property?.text() === "relation";
}

function callArgument(call: SgNode): SgNode | null {
  const args = call.children().find((child) => child.kind() === "arguments");
  if (!args) return null;

  const values = args
    .children()
    .filter((child) => !["(", ")", ",", "comment"].includes(child.kind()));
  return values.length === 1 ? values[0]! : null;
}

function pairKey(pair: SgNode): string | null {
  const key = pair.children()[0];
  return key?.text().replace(/^['"]|['"]$/g, "") ?? null;
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

function stringValue(node: SgNode | null): string | null {
  if (node?.kind() !== "string") return null;
  return node.text().replace(/^['"]|['"]$/g, "");
}

function needsReview(call: SgNode): boolean {
  const config = callArgument(call);
  if (config?.kind() !== "object") return config != null;

  const relationType = objectPair(config, "type");
  const toward = objectPair(config, "toward");
  if (!relationType || !toward) return false;
  if (stringValue(pairValue(relationType)) === "keyOnly") return false;

  const towardConfig = pairValue(toward);
  if (towardConfig?.kind() !== "object") return towardConfig != null;
  if (objectPair(towardConfig, "as")) return false;

  const targetType = objectPair(towardConfig, "type");
  if (!targetType) return false;
  return stringValue(pairValue(targetType)) !== "self";
}

export default function transform(_source: string, _filePath: string): null {
  return null;
}

export async function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): Promise<LlmReviewFinding[]> {
  if (!source.includes(".relation")) return [];

  const root = parse(sourceLang(filePath, source), source).root();
  return root
    .findAll({ rule: { kind: "call_expression" } })
    .filter((call) => isRelationCall(call) && needsReview(call))
    .map((call) => ({
      file: relativePath,
      line: call.range().start.line + 1,
      message: "Review the v2 forward GraphQL field name or add an explicit toward.as.",
      excerpt: call.text().split("\n", 1)[0]!.trim(),
    }));
}
