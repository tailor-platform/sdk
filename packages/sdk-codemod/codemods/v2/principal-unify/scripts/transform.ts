import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const TYPE_RENAME_MAP: Record<string, string> = {
  TailorUser: "TailorPrincipal",
  TailorActor: "TailorPrincipal",
  TailorInvoker: "TailorPrincipal",
};

const UNAUTHENTICATED = "unauthenticatedTailorUser";

function quickFilter(source: string): boolean {
  if (!source.includes("@tailor-platform/sdk")) return false;
  return (
    source.includes("TailorUser") ||
    source.includes("TailorActor") ||
    source.includes("TailorInvoker") ||
    source.includes(UNAUTHENTICATED) ||
    source.includes("createResolver")
  );
}

function isInsideImportStatement(node: SgNode): boolean {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

interface ImportRewriteResult {
  newText: string;
  touched: boolean;
}

function rebuildImportStatement(importStmt: SgNode): ImportRewriteResult {
  const importText = importStmt.text();
  const isImportType = /^\s*import\s+type\b/.test(importText);
  const trailingSemi = importText.trimEnd().endsWith(";") ? ";" : "";

  const specifiers = importStmt.findAll({ rule: { kind: "import_specifier" } });
  const newSpecTexts: string[] = [];
  const seenLocal = new Set<string>();
  let touched = false;

  for (const spec of specifiers) {
    const specText = spec.text();
    const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
    if (idents.length === 0) {
      newSpecTexts.push(specText);
      continue;
    }
    const importedName = idents[0]!.text();
    const aliasNode = idents[1];
    const localName = aliasNode?.text() ?? importedName;
    const isTypeOnly = /^\s*type\s+/.test(specText);

    const renamed = TYPE_RENAME_MAP[importedName];
    if (renamed) {
      touched = true;
      const finalLocal = aliasNode?.text() ?? renamed;
      if (seenLocal.has(finalLocal)) continue;
      seenLocal.add(finalLocal);
      const asPart = aliasNode ? ` as ${aliasNode.text()}` : "";
      newSpecTexts.push(`${isTypeOnly ? "type " : ""}${renamed}${asPart}`);
    } else if (importedName === UNAUTHENTICATED) {
      touched = true;
    } else {
      if (seenLocal.has(localName)) continue;
      seenLocal.add(localName);
      newSpecTexts.push(specText);
    }
  }

  if (!touched) return { newText: importText, touched: false };
  if (newSpecTexts.length === 0) return { newText: "", touched: true };

  const prefix = isImportType ? "import type " : "import ";
  return {
    newText: `${prefix}{ ${newSpecTexts.join(", ")} } from "@tailor-platform/sdk"${trailingSemi}`,
    touched: true,
  };
}

function hasLocalUserDeclaration(body: SgNode): boolean {
  const declIdents = body.findAll({
    rule: {
      kind: "identifier",
      regex: "^user$",
      inside: { kind: "variable_declarator" },
    },
  });
  if (declIdents.length > 0) return true;

  const declPatterns = body.findAll({
    rule: {
      kind: "shorthand_property_identifier_pattern",
      regex: "^user$",
      inside: { kind: "variable_declarator" },
    },
  });
  return declPatterns.length > 0;
}

function findResolverBodyArrow(call: SgNode): SgNode | null {
  const args = call.field("arguments");
  if (!args) return null;
  const objArg = args.children().find((c: SgNode) => c.kind() === "object");
  if (!objArg) return null;

  const pairs = objArg.findAll({ rule: { kind: "pair" } });
  for (const pair of pairs) {
    const key = pair.field("key");
    if (key?.text() !== "body") continue;
    const value = pair.field("value");
    if (!value) continue;
    if (value.kind() === "arrow_function" || value.kind() === "function_expression") {
      return value;
    }
  }
  return null;
}

function transformResolverBody(arrowNode: SgNode, edits: Edit[]): void {
  const params =
    arrowNode.field("parameters") ??
    arrowNode.field("parameter") ??
    arrowNode.children().find((c: SgNode) => c.kind() === "formal_parameters");
  const body = arrowNode.field("body");
  if (!params || !body) return;

  const userPatterns = params.findAll({
    rule: { kind: "shorthand_property_identifier_pattern", regex: "^user$" },
  });
  if (userPatterns.length > 0) {
    if (hasLocalUserDeclaration(body)) return;
    for (const p of userPatterns) {
      edits.push(p.replace("caller"));
    }
    const refs = body.findAll({ rule: { kind: "identifier", regex: "^user$" } });
    for (const ref of refs) {
      edits.push(ref.replace("caller"));
    }
    return;
  }

  const firstParam = params
    .children()
    .find(
      (c: SgNode) =>
        c.kind() === "required_parameter" ||
        c.kind() === "optional_parameter" ||
        c.kind() === "identifier" ||
        c.kind() === "object_pattern",
    );
  if (!firstParam) return;
  if (firstParam.kind() === "object_pattern") return;

  let paramIdent: SgNode | undefined;
  if (firstParam.kind() === "identifier") {
    paramIdent = firstParam;
  } else {
    const pattern = firstParam.field("pattern");
    if (pattern && pattern.kind() === "identifier") paramIdent = pattern;
  }
  if (!paramIdent) return;

  const ctxName = paramIdent.text();
  const propertyAccesses = body.findAll({
    rule: { kind: "property_identifier", regex: "^user$" },
  });
  for (const propId of propertyAccesses) {
    const parent = propId.parent();
    if (!parent || parent.kind() !== "member_expression") continue;
    const obj = parent.field("object");
    if (obj && obj.kind() === "identifier" && obj.text() === ctxName) {
      edits.push(propId.replace("caller"));
    }
  }
}

/**
 * Migrate user/actor/invoker types and identifiers to the unified TailorPrincipal.
 *
 * - Renames `TailorUser` / `TailorActor` / `TailorInvoker` type references to `TailorPrincipal`.
 * - Rewrites SDK imports to use `TailorPrincipal` (with dedupe) and drops `unauthenticatedTailorUser`.
 * - Replaces value references to `unauthenticatedTailorUser` with `null`.
 * - Renames `user` to `caller` inside `createResolver({ body })` parameters and bodies, and
 *   `<ctx>.user` to `<ctx>.caller` for non-destructured single-param resolver bodies.
 * @param source - TypeScript source text.
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string): string | null {
  if (!quickFilter(source)) return null;

  const tree = parse(Lang.TypeScript, source).root();
  const edits: Edit[] = [];

  const typeIdents = tree.findAll({
    rule: {
      kind: "type_identifier",
      not: { inside: { kind: "import_statement" } },
    },
  });
  for (const id of typeIdents) {
    const newName = TYPE_RENAME_MAP[id.text()];
    if (newName) edits.push(id.replace(newName));
  }

  const sdkImports = tree.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: "^[\"']@tailor-platform/sdk[\"']$" },
    },
  });
  for (const importStmt of sdkImports) {
    const { newText, touched } = rebuildImportStatement(importStmt);
    if (touched) edits.push(importStmt.replace(newText));
  }

  const uauIds = tree.findAll({
    rule: {
      kind: "identifier",
      regex: `^${UNAUTHENTICATED}$`,
    },
  });
  for (const id of uauIds) {
    if (isInsideImportStatement(id)) continue;
    edits.push(id.replace("null"));
  }

  const resolverCalls = tree.findAll({
    rule: {
      kind: "call_expression",
      has: {
        field: "function",
        kind: "identifier",
        regex: "^createResolver$",
      },
    },
  });
  for (const call of resolverCalls) {
    const arrow = findResolverBodyArrow(call);
    if (arrow) transformResolverBody(arrow, edits);
  }

  if (edits.length === 0) return null;
  return tree.commitEdits(edits);
}
