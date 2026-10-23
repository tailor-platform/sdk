import { parse, Lang } from "@ast-grep/napi";
import { findImportStatements } from "../../../../src/ast-grep-helpers";
import {
  collectWorkflowLocals,
  isAmbientTailorWorkflow,
  tailorIsAmbientGlobal,
} from "../../../../src/workflow-bindings";
import type { Edit, SgNode } from "@ast-grep/napi";

const RENAMES: Record<string, string> = {
  triggerWorkflow: "startWorkflow",
  triggerJobFunction: "execJobFunction",
  resumeWorkflow: "resumeWorkflowExecution",
};

function quickFilter(source: string): boolean {
  return Object.keys(RENAMES).some((name) => source.includes(name));
}

function sourceLang(filePath: string, source: string): Lang {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return Lang.Tsx;
  return source.includes("</") || source.includes("/>") ? Lang.Tsx : Lang.TypeScript;
}

function expressionArguments(args: SgNode): SgNode[] {
  return args.children().filter((child) => !["(", ")", ","].includes(child.kind() as string));
}

function thirdArgument(member: SgNode): SgNode | null {
  const call = member.parent();
  if (call?.kind() !== "call_expression") return null;
  const args = call.field("arguments");
  if (!args) return null;
  return expressionArguments(args)[2] ?? null;
}

/**
 * A `triggerWorkflow(name, args, options)` call whose third argument is not a
 * literal object (e.g. a variable), or is an object literal that spreads one
 * (`{ ...rest }`), cannot be safely renamed: we cannot tell whether it carries
 * an `invoker` key that also needs renaming to `authInvoker`, and renaming
 * just the method name would erase the `triggerWorkflow` token that flags the
 * call for manual review, while the option silently stops working at
 * runtime. Such calls are left entirely unrenamed.
 * @param member - The `.triggerWorkflow` member-expression node being considered
 * @returns Whether the call must be skipped
 */
function hasUnsafeThirdArgument(member: SgNode): boolean {
  const optionsArg = thirdArgument(member);
  if (optionsArg === null) return false;
  if (optionsArg.kind() !== "object") return true;
  return optionsArg.children().some((child) => child.kind() === "spread_element");
}

/**
 * `triggerWorkflow`'s removed SDK wrapper converted an `invoker` option to
 * the platform's `authInvoker` shape before calling through; `startWorkflow`
 * expects `authInvoker` directly. Build an edit renaming a literal `invoker`
 * key (or shorthand) in the third argument of a `triggerWorkflow(...)` call
 * being renamed to `startWorkflow`, so the option keeps working.
 * @param member - The `.triggerWorkflow` member-expression node being renamed
 * @returns An edit renaming the `invoker` key, or null when not applicable
 */
function findInvokerOptionEdit(member: SgNode): Edit | null {
  const optionsArg = thirdArgument(member);
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
 * member accesses to their canonical `startWorkflow`/`execJobFunction`/
 * `resumeWorkflowExecution` names,
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

    if (newName === "startWorkflow") {
      if (hasUnsafeThirdArgument(member)) continue;
      edits.push(property.replace(newName));
      const invokerEdit = findInvokerOptionEdit(member);
      if (invokerEdit) edits.push(invokerEdit);
    } else {
      edits.push(property.replace(newName));
    }
  }

  if (edits.length === 0) return null;
  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
