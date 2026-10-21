import { parse } from "@ast-grep/napi";
import { callArgument, pairValue, sourceLang } from "../../../../src/ast-grep-helpers";
import {
  hasDynamicProperties,
  isRelationCall,
  literalStringValue,
  objectPair,
  relationAliases,
} from "../../../../src/relation-call";
import type { LlmReviewFinding } from "../../../../src/types";
import type { SgNode } from "@ast-grep/napi";

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

  const targetType = objectPair(towardConfig, "type");
  if (targetType && literalStringValue(pairValue(targetType)) === "self") return false;

  const as = objectPair(towardConfig, "as");
  if (as) {
    const explicitName = literalStringValue(pairValue(as));
    return explicitName === null || explicitName.length === 0;
  }

  if (!targetType) return false;
  return true;
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
