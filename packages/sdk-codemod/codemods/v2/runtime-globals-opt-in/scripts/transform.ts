import { parse, Lang } from "@ast-grep/napi";
import {
  buildAddNamedImportEdit,
  findImportStatements,
  importBindings,
  localDeclarationNames,
} from "../../../../src/ast-grep-helpers";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const TAILOR_IDP_CLIENT = "tailor.idp.Client";
const NON_ARGUMENT_KINDS = new Set(["(", ")", ",", "comment"]);

function quickFilter(source: string): boolean {
  return source.includes(TAILOR_IDP_CLIENT);
}

function sourceLang(filePath: string, source: string): Lang {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx") || source.includes("</")
    ? Lang.Tsx
    : Lang.TypeScript;
}

function runtimeIdpLocalName(imports: SgNode[]): string | null {
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (
        binding.source === RUNTIME_MODULE &&
        binding.importedName === "idp" &&
        !binding.typeOnly
      ) {
        return binding.localName;
      }
    }
  }
  return null;
}

function isRuntimeIdpBinding(binding: ReturnType<typeof importBindings>[number]): boolean {
  return binding.source === RUNTIME_MODULE && binding.importedName === "idp";
}

function hasCollision(
  imports: SgNode[],
  localNames: Set<string>,
  idpLocal: string,
  injectingNewIdpName: boolean,
): boolean {
  if (
    localNames.has("tailor") ||
    (injectingNewIdpName && localNames.has("idp")) ||
    localNames.has(idpLocal)
  )
    return true;

  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (binding.localName === "tailor") return true;
      if (binding.localName !== "idp") continue;
      if (isRuntimeIdpBinding(binding)) continue;
      return true;
    }
  }

  return false;
}

function isDirectiveStatement(node: SgNode): boolean {
  return node.kind() === "expression_statement" && node.children()[0]?.kind() === "string";
}

function importInsertionIndex(root: SgNode, imports: SgNode[], source: string): number {
  const lastImport = imports.at(-1);
  if (lastImport) return lastImport.range().end.index;

  let pos = 0;
  if (source.startsWith("#!")) {
    const newlineIndex = source.indexOf("\n");
    pos = newlineIndex === -1 ? source.length : newlineIndex + 1;
  }

  for (const child of root.children()) {
    if (child.range().start.index < pos) continue;
    if (child.kind() === "comment") {
      pos = child.range().end.index;
      continue;
    }
    if (!isDirectiveStatement(child)) break;
    pos = child.range().end.index;
  }

  return pos;
}

function buildAddRuntimeImportEdit(root: SgNode, source: string, imports: SgNode[]): Edit {
  return buildAddNamedImportEdit({
    importName: "idp",
    imports,
    insertionIndex: importInsertionIndex,
    moduleName: RUNTIME_MODULE,
    root,
    source,
  });
}

function argumentExpressions(args: SgNode): SgNode[] {
  return args.children().filter((child) => !NON_ARGUMENT_KINDS.has(child.kind()));
}

function hasConstructorArguments(newExpression: SgNode): boolean {
  const args = newExpression.field("arguments");
  return args ? argumentExpressions(args).length > 0 : false;
}

function findTailorIdpClientConstructors(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "new_expression" } })
    .filter(hasConstructorArguments)
    .map((node) => node.field("constructor"))
    .filter((node): node is SgNode => node?.text() === TAILOR_IDP_CLIENT);
}

/**
 * Rewrite direct `new tailor.idp.Client(...)` calls to the typed runtime
 * wrapper. Files with local `tailor` or conflicting `idp` bindings are left
 * unchanged for the runtime-globals review prompt.
 * @param source - File contents
 * @param filePath - Absolute path to the file
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath: string): string | null {
  if (!quickFilter(source)) return null;

  const root = parse(sourceLang(filePath, source), source).root();
  const constructors = findTailorIdpClientConstructors(root);
  if (constructors.length === 0) return null;

  const imports = findImportStatements(root);
  const existingIdpLocal = runtimeIdpLocalName(imports);
  const idpLocal = existingIdpLocal ?? "idp";
  if (hasCollision(imports, localDeclarationNames(root), idpLocal, existingIdpLocal === null)) {
    return null;
  }

  const edits: Edit[] = constructors.map((constructor) =>
    constructor.replace(`${idpLocal}.Client`),
  );

  if (!existingIdpLocal) {
    if (filePath.endsWith(".cts")) return null;
    edits.push(buildAddRuntimeImportEdit(root, source, imports));
  }

  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
