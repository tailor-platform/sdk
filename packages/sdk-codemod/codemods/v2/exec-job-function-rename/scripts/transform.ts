import { parse, Lang } from "@ast-grep/napi";
import {
  findImportStatements,
  importBindings,
  importSource,
  importSpecNames,
  localDeclarationNames,
} from "../../../../src/ast-grep-helpers";
import type { Edit, SgNode } from "@ast-grep/napi";

const DEPRECATED_METHOD = "startJobFunction";
const CANONICAL_METHOD = "execJobFunction";
const DEPRECATED_OPTIONS = "StartJobFunctionOptions";
const CANONICAL_OPTIONS = "ExecJobFunctionOptions";

const WORKFLOW_MODULE_SOURCES = new Set([
  "@tailor-platform/sdk/runtime",
  "@tailor-platform/sdk/runtime/workflow",
]);

function quickFilter(source: string): boolean {
  return source.includes(DEPRECATED_METHOD) || source.includes(DEPRECATED_OPTIONS);
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

/**
 * Rename `StartJobFunctionOptions` import specifiers from the runtime module,
 * plus the type references that resolve to them when the import is not aliased.
 * @param root - Parsed file root
 * @param imports - Top-level import statements
 * @returns Edits renaming the deprecated options type
 */
function optionsTypeEdits(root: SgNode, imports: SgNode[]): Edit[] {
  const edits: Edit[] = [];
  for (const importStmt of imports) {
    const source = importSource(importStmt);
    if (source === null || !WORKFLOW_MODULE_SOURCES.has(source)) continue;

    const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
    // Renaming into a name the same import already binds would emit a duplicate
    // specifier, so leave those files to the residual-pattern warning instead.
    if (specs.some((spec) => importSpecNames(spec)?.importedName === CANONICAL_OPTIONS)) continue;

    for (const spec of specs) {
      const names = importSpecNames(spec);
      if (names?.importedName !== DEPRECATED_OPTIONS) continue;
      const importedNode = spec.children().find((child) => child.kind() === "identifier");
      if (!importedNode) continue;
      edits.push(importedNode.replace(CANONICAL_OPTIONS));
      if (names.localName !== DEPRECATED_OPTIONS) continue;
      for (const reference of root.findAll({
        rule: { kind: "type_identifier", regex: `^${DEPRECATED_OPTIONS}$` },
      })) {
        edits.push(reference.replace(CANONICAL_OPTIONS));
      }
    }
  }
  return edits;
}

/**
 * Rewrite `.startJobFunction(` member accesses — on the ambient
 * `tailor.workflow` global or on a `workflow` value imported from
 * `@tailor-platform/sdk/runtime(/workflow)` — to the canonical
 * `execJobFunction`, and rename the `StartJobFunctionOptions` type alias.
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

  const edits = optionsTypeEdits(root, imports);
  for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
    const property = member.field("property");
    if (!property || property.kind() !== "property_identifier") continue;
    if (property.text() !== DEPRECATED_METHOD) continue;

    const object = member.field("object");
    if (!object) continue;

    const isWorkflowImportReceiver =
      object.kind() === "identifier" && workflowLocals.has(object.text());
    const isAmbientReceiver = tailorIsAmbient && isAmbientTailorWorkflow(object);
    if (!isWorkflowImportReceiver && !isAmbientReceiver) continue;

    edits.push(property.replace(CANONICAL_METHOD));
  }

  if (edits.length === 0) return null;
  const result = root.commitEdits(edits);
  return result === source ? null : result;
}
