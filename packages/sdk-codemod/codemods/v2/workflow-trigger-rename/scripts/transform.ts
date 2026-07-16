import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  localDeclarationNames,
} from "../../../../src/ast-grep-helpers";
import type { Edit, SgNode } from "@ast-grep/napi";

const RENAMES: Record<string, string> = {
  triggerWorkflow: "startWorkflow",
  triggerJobFunction: "startJobFunction",
  resumeWorkflow: "resumeWorkflowExecution",
};

const WORKFLOW_MODULE_SOURCES = new Set([
  "@tailor-platform/sdk/runtime",
  "@tailor-platform/sdk/runtime/workflow",
]);

function quickFilter(source: string): boolean {
  return Object.keys(RENAMES).some((name) => source.includes(name));
}

function sourceLang(filePath: string, source: string): Lang {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return Lang.Tsx;
  return source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
}

function collectWorkflowLocals(root: SgNode, imports: SgNode[]): Set<string> {
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

function tailorIsAmbientGlobal(root: SgNode, imports: SgNode[]): boolean {
  const declaredNames = localDeclarationNames(root);
  if (declaredNames.has("tailor")) return false;
  return !imports.some((stmt) => importBindings(stmt).some((b) => b.localName === "tailor"));
}

function isAmbientTailorWorkflow(object: SgNode | null): boolean {
  if (!object || object.kind() !== "member_expression") return false;
  const base = object.field("object");
  const property = object.field("property");
  return (
    base?.kind() === "identifier" && base.text() === "tailor" && property?.text() === "workflow"
  );
}

function expressionArguments(args: SgNode): SgNode[] {
  return args.children().filter((child) => !["(", ")", ","].includes(child.kind() as string));
}

/**
 * `triggerWorkflow`'s removed SDK wrapper converted an `invoker` option to
 * the platform's `authInvoker` shape before calling through; `startWorkflow`
 * expects `authInvoker` directly. Build an edit renaming a literal `invoker`
 * key (or shorthand) in the third argument of a `triggerWorkflow(...)` call
 * being renamed to `startWorkflow`, so the option keeps working. Options
 * passed via a variable/spread are left for manual review — only literal
 * object arguments are inspected here.
 * @param member - The `.triggerWorkflow` member-expression node being renamed
 * @returns An edit renaming the `invoker` key, or null when not applicable
 */
function findInvokerOptionEdit(member: SgNode): Edit | null {
  const call = member.parent();
  if (call?.kind() !== "call_expression") return null;
  const args = call.field("arguments");
  if (!args) return null;

  const optionsArg = expressionArguments(args)[2];
  if (!optionsArg || optionsArg.kind() !== "object") return null;

  for (const child of optionsArg.children()) {
    if (child.kind() === "pair") {
      const key = child.field("key");
      if (key?.kind() === "property_identifier" && key.text() === "invoker") {
        return key.replace("authInvoker");
      }
    } else if (child.kind() === "shorthand_property_identifier" && child.text() === "invoker") {
      return child.replace("authInvoker: invoker");
    }
  }
  return null;
}

/**
 * Rewrite `.triggerWorkflow(`, `.triggerJobFunction(`, and `.resumeWorkflow(`
 * member accesses to their canonical `start*`/`resumeWorkflowExecution` names,
 * either on the ambient `tailor.workflow` global or on a `workflow` value
 * imported from `@tailor-platform/sdk/runtime(/workflow)`.
 * @param source - File contents
 * @param filePath - Absolute path to the file
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string, filePath?: string): string | null {
  if (!quickFilter(source)) return null;

  const root = parse(sourceLang(filePath ?? "", source), source).root();
  const imports = findImportStatements(root);
  const workflowLocals = collectWorkflowLocals(root, imports);
  const tailorIsAmbient = tailorIsAmbientGlobal(root, imports);

  const edits: Edit[] = [];
  for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
    const property = member.field("property");
    if (!property || property.kind() !== "property_identifier") continue;
    const newName = RENAMES[property.text()];
    if (!newName) continue;

    const object = member.field("object");
    if (!object) continue;

    const isWorkflowImportReceiver =
      object.kind() === "identifier" && workflowLocals.has(object.text());
    const isAmbientReceiver = tailorIsAmbient && isAmbientTailorWorkflow(object);
    if (!isWorkflowImportReceiver && !isAmbientReceiver) continue;

    edits.push(property.replace(newName));
    if (newName === "startWorkflow") {
      const invokerEdit = findInvokerOptionEdit(member);
      if (invokerEdit) edits.push(invokerEdit);
    }
  }

  if (edits.length === 0) return null;
  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
