import { importBindings, localDeclarationNames } from "./ast-grep-helpers";
import type { SgNode } from "@ast-grep/napi";

export const WORKFLOW_MODULE_SOURCES = new Set([
  "@tailor-platform/sdk/runtime",
  "@tailor-platform/sdk/runtime/workflow",
]);

export function collectWorkflowLocals(root: SgNode, imports: SgNode[]): Set<string> {
  const locals = new Set<string>();
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (binding.importedName === "workflow" && WORKFLOW_MODULE_SOURCES.has(binding.source)) {
        locals.add(binding.localName);
      }
    }
  }

  // Coarse safety check: a local name also declared elsewhere in the file
  // (shadowing the import) is dropped rather than range-tracked.
  const declaredNames = localDeclarationNames(root);
  for (const name of locals) {
    if (declaredNames.has(name)) locals.delete(name);
  }
  return locals;
}

export function tailorIsAmbientGlobal(root: SgNode, imports: SgNode[]): boolean {
  const declaredNames = localDeclarationNames(root);
  if (declaredNames.has("tailor")) return false;
  return !imports.some((stmt) => importBindings(stmt).some((b) => b.localName === "tailor"));
}

export function isAmbientTailorWorkflow(object: SgNode | null): boolean {
  if (!object || object.kind() !== "member_expression") return false;
  const base = object.field("object");
  const property = object.field("property");
  return (
    base?.kind() === "identifier" && base.text() === "tailor" && property?.text() === "workflow"
  );
}
