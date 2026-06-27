import { parse, Lang } from "@ast-grep/napi";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const TYPE_RENAME_MAP: Record<string, string> = {
  TailorUser: "TailorPrincipal",
  TailorActor: "TailorPrincipal",
  TailorActorType: "TailorPrincipal",
  TailorInvoker: "TailorPrincipal",
};

const UNAUTHENTICATED = "unauthenticatedTailorUser";

const QUICK_FILTER_NEEDLES = [
  ...Object.keys(TYPE_RENAME_MAP),
  UNAUTHENTICATED,
  "userId",
  "userType",
  "createResolver",
  ".hooks",
  ".validate",
  ".parse",
];

const ACTOR_PROPERTY_RENAME_MAP: Record<string, string> = {
  userId: "id",
  userType: "type",
};

const ACTOR_TYPE_LITERAL_RENAME_MAP: Record<string, string> = {
  USER_TYPE_USER: "user",
  USER_TYPE_MACHINE_USER: "machine_user",
};

function quickFilter(source: string): boolean {
  if (!source.includes("@tailor-platform/sdk")) return false;
  return QUICK_FILTER_NEEDLES.some((needle) => source.includes(needle));
}

function isInsideImportStatement(node: SgNode): boolean {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

function memberObjectParent(node: SgNode): SgNode | null {
  const parent = node.parent();
  if (
    !parent ||
    (parent.kind() !== "member_expression" && parent.kind() !== "subscript_expression")
  ) {
    return null;
  }
  const obj = parent.field("object");
  if (!obj) return null;
  const r = node.range();
  const or = obj.range();
  if (r.start.index !== or.start.index || r.end.index !== or.end.index) return null;
  return parent;
}

function isMemberExpressionObject(node: SgNode): boolean {
  return memberObjectParent(node) !== null;
}

function optionalPrincipalReadKind(node: SgNode): "property" | "computed" | null {
  const parent = memberObjectParent(node);
  if (!parent) return null;
  if (parent.text().startsWith(`${node.text()}?.`)) return null;
  if (isAssignmentTargetReference(node)) return null;
  if (parent.kind() === "subscript_expression") return "computed";
  return parent.field("property")?.kind() === "property_identifier" ? "property" : null;
}

function isOptionalizableMemberObject(node: SgNode): boolean {
  return optionalPrincipalReadKind(node) !== null;
}

function principalIdentifierReplacement(node: SgNode, name: string): string {
  const readKind = optionalPrincipalReadKind(node);
  if (readKind === "computed") return `${name}?.`;
  if (readKind === "property") return `${name}?`;
  return name;
}

function principalPropertyReplacement(node: SgNode, name: string): string {
  const parent = node.parent();
  return parent ? principalIdentifierReplacement(parent, name) : name;
}

function isObjectDestructureInitializer(node: SgNode): boolean {
  const parent = node.parent();
  if (!parent || parent.kind() !== "variable_declarator") return false;
  const value = parent.field("value");
  if (!value) return false;
  const valueRange = value.range();
  const nodeRange = node.range();
  if (
    valueRange.start.index !== nodeRange.start.index ||
    valueRange.end.index !== nodeRange.end.index
  ) {
    return false;
  }
  return parent.field("name")?.kind() === "object_pattern";
}

function principalReadReplacement(node: SgNode, name: string): string {
  return isObjectDestructureInitializer(node)
    ? `${name} ?? {}`
    : principalIdentifierReplacement(node, name);
}

function nodeRangeContains(outer: SgNode, inner: SgNode): boolean {
  const outerRange = outer.range();
  const innerRange = inner.range();
  return (
    innerRange.start.index >= outerRange.start.index && innerRange.end.index <= outerRange.end.index
  );
}

function isAssignmentTargetReference(node: SgNode): boolean {
  let current = node;
  let parent = current.parent();
  while (
    parent &&
    (parent.kind() === "member_expression" || parent.kind() === "subscript_expression")
  ) {
    const object = parent.field("object");
    if (!object || !nodeRangeContains(object, current)) break;
    current = parent;
    parent = current.parent();
  }

  if (!parent) return false;
  if (parent.kind() === "update_expression") return true;
  if (
    parent.kind() !== "assignment_expression" &&
    parent.kind() !== "augmented_assignment_expression"
  ) {
    return false;
  }
  const left = parent.field("left");
  return !!left && nodeRangeContains(left, current);
}

function parseArgumentCall(node: SgNode): SgNode | null {
  if (node.kind() !== "shorthand_property_identifier") return null;
  const object = node.parent();
  if (!object || object.kind() !== "object") return null;
  const args = object.parent();
  if (!args || args.kind() !== "arguments") return null;
  const call = args.parent();
  return call && call.kind() === "call_expression" && findMemberCallName(call) === "parse"
    ? call
    : null;
}

interface SdkFieldParseContext {
  sdkFieldRootNames: Set<string>;
  sdkFieldLocalBindings: SdkFieldLocalBinding[];
  root: SgNode;
}

function isSdkFieldParseArgumentShorthand(
  node: SgNode,
  parseContext: SdkFieldParseContext,
): boolean {
  const call = parseArgumentCall(node);
  return call
    ? isSdkFieldMemberCall(
        call,
        parseContext.sdkFieldRootNames,
        parseContext.sdkFieldLocalBindings,
        parseContext.root,
      )
    : false;
}

function addActorPropertyReplacement(
  property: SgNode,
  edits: Edit[],
  transformedActorPropertyStarts: Set<number>,
): void {
  const newName = ACTOR_PROPERTY_RENAME_MAP[property.text()];
  if (!newName) return;
  const start = property.range().start.index;
  if (transformedActorPropertyStarts.has(start)) return;
  transformedActorPropertyStarts.add(start);
  edits.push(property.replace(newName));
}

function actorTypeLiteralReplacement(literal: SgNode): string | null {
  const match = literal
    .text()
    .match(/^(['"])(USER_TYPE_USER|USER_TYPE_MACHINE_USER|USER_TYPE_UNSPECIFIED)\1$/);
  if (!match) return null;
  const [, quote, value] = match;
  if (value === "USER_TYPE_UNSPECIFIED") return "undefined";
  return `${quote}${ACTOR_TYPE_LITERAL_RENAME_MAP[value]!}${quote}`;
}

function addActorTypeLiteralReplacement(
  literal: SgNode,
  edits: Edit[],
  transformedLiteralStarts: Set<number>,
): void {
  if (literal.kind() !== "string") return;
  const replacement = actorTypeLiteralReplacement(literal);
  if (!replacement) return;
  const start = literal.range().start.index;
  if (transformedLiteralStarts.has(start)) return;
  transformedLiteralStarts.add(start);
  edits.push(literal.replace(replacement));
}

function transformActorTypeLiteralsInNode(
  node: SgNode,
  edits: Edit[],
  transformedLiteralStarts: Set<number>,
): void {
  if (node.kind() === "string") {
    addActorTypeLiteralReplacement(node, edits, transformedLiteralStarts);
  }
  const literals = node.findAll({ rule: { kind: "string" } });
  for (const literal of literals) {
    addActorTypeLiteralReplacement(literal, edits, transformedLiteralStarts);
  }
}

function isTransformedActorTypeMember(
  node: SgNode,
  transformedActorPropertyStarts: Set<number>,
): boolean {
  if (node.kind() !== "member_expression") return false;
  const property = node.field("property");
  return (
    property?.text() === "userType" &&
    transformedActorPropertyStarts.has(property.range().start.index)
  );
}

function nodeContainsTransformedActorTypeMember(
  node: SgNode,
  transformedActorPropertyStarts: Set<number>,
): boolean {
  if (isTransformedActorTypeMember(node, transformedActorPropertyStarts)) return true;
  const members = node.findAll({ rule: { kind: "member_expression" } });
  return members.some((member) =>
    isTransformedActorTypeMember(member, transformedActorPropertyStarts),
  );
}

function switchDiscriminant(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() === "parenthesized_expression") ?? null;
}

function switchBody(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() === "switch_body") ?? null;
}

function transformActorTypeComparisonLiterals(
  root: SgNode,
  edits: Edit[],
  transformedActorPropertyStarts: Set<number>,
): void {
  if (transformedActorPropertyStarts.size === 0) return;
  const transformedLiteralStarts = new Set<number>();
  const binaries = root.findAll({ rule: { kind: "binary_expression" } });
  for (const binary of binaries) {
    if (
      !binary
        .children()
        .some((child) => isTransformedActorTypeMember(child, transformedActorPropertyStarts))
    ) {
      continue;
    }
    for (const child of binary.children()) {
      addActorTypeLiteralReplacement(child, edits, transformedLiteralStarts);
    }
  }

  const switches = root.findAll({ rule: { kind: "switch_statement" } });
  for (const switchNode of switches) {
    const discriminant = switchDiscriminant(switchNode);
    if (
      !discriminant ||
      !nodeContainsTransformedActorTypeMember(discriminant, transformedActorPropertyStarts)
    ) {
      continue;
    }
    const body = switchBody(switchNode);
    if (!body) continue;
    const cases = body.findAll({ rule: { kind: "switch_case" } });
    for (const caseNode of cases) {
      for (const child of caseNode.children()) {
        addActorTypeLiteralReplacement(child, edits, transformedLiteralStarts);
      }
    }
  }
}

function transformTailorActorTypeInitializerLiterals(
  root: SgNode,
  actorTypeLocalNames: Set<string>,
  sdkNamespaceNames: Set<string>,
  edits: Edit[],
): void {
  if (actorTypeLocalNames.size === 0 && sdkNamespaceNames.size === 0) return;
  const transformedLiteralStarts = new Set<number>();
  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    if (
      !isSdkTypeReference(decl, actorTypeLocalNames, "TailorActorType", sdkNamespaceNames, root)
    ) {
      continue;
    }
    const value = decl.field("value");
    if (!value) continue;
    transformActorTypeLiteralsInNode(value, edits, transformedLiteralStarts);
  }
}

function transformActorTypeBindingComparisons(
  root: SgNode,
  binding: PrincipalLocalBinding,
  edits: Edit[],
): void {
  const refs = root.findAll({
    rule: { kind: "identifier", regex: `^${escapeRegex(binding.name)}$` },
  });
  const transformedLiteralStarts = new Set<number>();
  for (const ref of refs) {
    const binary = ref.parent();
    if (!binary || binary.kind() !== "binary_expression") continue;
    if (
      isShadowedLocalReference(root, binding.name, ref.range().start.index, binding.bindingStart)
    ) {
      continue;
    }
    for (const child of binary.children()) {
      addActorTypeLiteralReplacement(child, edits, transformedLiteralStarts);
    }
  }

  const switches = root.findAll({ rule: { kind: "switch_statement" } });
  for (const switchNode of switches) {
    const discriminant = switchDiscriminant(switchNode);
    if (!discriminant) continue;
    const refs = discriminant.findAll({
      rule: { kind: "identifier", regex: `^${escapeRegex(binding.name)}$` },
    });
    const matchesBinding = refs.some(
      (ref) =>
        !isShadowedLocalReference(
          root,
          binding.name,
          ref.range().start.index,
          binding.bindingStart,
        ),
    );
    if (!matchesBinding) continue;
    const body = switchBody(switchNode);
    if (!body) continue;
    const cases = body.findAll({ rule: { kind: "switch_case" } });
    for (const caseNode of cases) {
      for (const child of caseNode.children()) {
        addActorTypeLiteralReplacement(child, edits, transformedLiteralStarts);
      }
    }
  }
}

function transformTailorActorTypeBindingComparisons(
  root: SgNode,
  actorTypeLocalNames: Set<string>,
  sdkNamespaceNames: Set<string>,
  edits: Edit[],
): void {
  if (actorTypeLocalNames.size === 0 && sdkNamespaceNames.size === 0) return;

  for (const kind of NESTED_FN_KINDS) {
    const fns = root.findAll({ rule: { kind } });
    for (const fn of fns) {
      const param = getFirstFunctionParam(fn);
      if (
        !param ||
        !isSdkTypeReference(param, actorTypeLocalNames, "TailorActorType", sdkNamespaceNames, root)
      ) {
        continue;
      }
      const pattern = getFunctionParamPattern(param);
      const body = fn.field("body");
      if (!pattern || pattern.kind() !== "identifier" || !body) continue;
      transformActorTypeBindingComparisons(
        body,
        { name: pattern.text(), bindingStart: pattern.range().start.index },
        edits,
      );
    }
  }

  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    if (
      !isSdkTypeReference(decl, actorTypeLocalNames, "TailorActorType", sdkNamespaceNames, root)
    ) {
      continue;
    }
    const name = decl.field("name");
    if (!name || name.kind() !== "identifier") continue;
    transformActorTypeBindingComparisons(
      root,
      { name: name.text(), bindingStart: name.range().start.index },
      edits,
    );
  }
}

function transformActorBindingMemberAccesses(
  root: SgNode,
  binding: PrincipalLocalBinding,
  edits: Edit[],
  transformedActorPropertyStarts: Set<number>,
): void {
  const refs = root.findAll({
    rule: { kind: "identifier", regex: `^${escapeRegex(binding.name)}$` },
  });
  for (const ref of refs) {
    const parent = ref.parent();
    if (!parent || parent.kind() !== "member_expression") continue;
    const object = parent.field("object");
    if (!object || object.range().start.index !== ref.range().start.index) continue;
    const property = parent.field("property");
    if (!property || property.kind() !== "property_identifier") continue;
    if (!ACTOR_PROPERTY_RENAME_MAP[property.text()]) continue;
    const pos = ref.range().start.index;
    if (isShadowedLocalReference(root, binding.name, pos, binding.bindingStart)) continue;
    addActorPropertyReplacement(property, edits, transformedActorPropertyStarts);
  }
}

function isSdkTypeReference(
  node: SgNode,
  localNames: Set<string>,
  sdkTypeName: string,
  sdkNamespaceNames: Set<string>,
  root: SgNode,
): boolean {
  const typeAnnotation = node.field("type");
  if (!typeAnnotation) return false;
  const typeIds = typeAnnotation.findAll({ rule: { kind: "type_identifier" } });
  return typeIds.some(
    (id) =>
      localNames.has(id.text()) ||
      (id.text() === sdkTypeName &&
        isSdkNamespaceQualifiedTypeIdentifier(id, sdkNamespaceNames, root)),
  );
}

function transformTailorActorTypedMemberAccesses(
  root: SgNode,
  actorTypeLocalNames: Set<string>,
  sdkNamespaceNames: Set<string>,
  edits: Edit[],
  transformedActorPropertyStarts: Set<number>,
): void {
  if (actorTypeLocalNames.size === 0 && sdkNamespaceNames.size === 0) return;

  for (const kind of NESTED_FN_KINDS) {
    const fns = root.findAll({ rule: { kind } });
    for (const fn of fns) {
      const param = getFirstFunctionParam(fn);
      if (
        !param ||
        !isSdkTypeReference(param, actorTypeLocalNames, "TailorActor", sdkNamespaceNames, root)
      ) {
        continue;
      }
      const pattern = getFunctionParamPattern(param);
      const body = fn.field("body");
      if (!pattern || pattern.kind() !== "identifier" || !body) continue;
      transformActorBindingMemberAccesses(
        body,
        { name: pattern.text(), bindingStart: pattern.range().start.index },
        edits,
        transformedActorPropertyStarts,
      );
    }
  }

  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    if (!isSdkTypeReference(decl, actorTypeLocalNames, "TailorActor", sdkNamespaceNames, root)) {
      continue;
    }
    const name = decl.field("name");
    if (!name || name.kind() !== "identifier") continue;
    transformActorBindingMemberAccesses(
      root,
      { name: name.text(), bindingStart: name.range().start.index },
      edits,
      transformedActorPropertyStarts,
    );
  }
}

function transformExecutorCtxActorAccesses(
  body: SgNode,
  ctxName: string,
  ctxShadowRanges: Array<[number, number]>,
  edits: Edit[],
  transformedActorPropertyStarts: Set<number>,
): void {
  const properties = body.findAll({
    rule: { kind: "property_identifier", regex: "^(userId|userType)$" },
  });
  for (const property of properties) {
    const parent = property.parent();
    if (!parent || parent.kind() !== "member_expression") continue;
    const object = parent.field("object");
    if (!object || object.kind() !== "member_expression") continue;
    const actorProperty = object.field("property");
    if (actorProperty?.text() !== "actor") continue;
    const ctxObject = object.field("object");
    if (!ctxObject || ctxObject.kind() !== "identifier" || ctxObject.text() !== ctxName) continue;
    const pos = ctxObject.range().start.index;
    if (isInsideAnyRange(pos, ctxShadowRanges)) continue;
    addActorPropertyReplacement(property, edits, transformedActorPropertyStarts);
  }
}

function renamedTypeIdentifierText(name: string): string | null {
  if (name === "TailorInvoker") return "(TailorPrincipal | null)";
  if (name === "TailorActorType") return '(TailorPrincipal["type"] | undefined)';
  return TYPE_RENAME_MAP[name] ?? null;
}

interface ImportRewriteResult {
  newText: string;
  touched: boolean;
}

function extractModuleSource(importText: string): string {
  const m = importText.match(/from\s+(["'])([^"']+)\1/);
  return m?.[2] ?? "@tailor-platform/sdk";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ImportSpec {
  spec: SgNode;
  importedName: string;
  aliasNode: SgNode | undefined;
  localName: string;
}

/**
 * Yield each import specifier in `importStmt` along with its imported name and
 * optional alias. `import { Foo as Bar }` produces `{ importedName: "Foo",
 * aliasNode: <Bar>, localName: "Bar" }`; `import { Foo }` produces
 * `{ importedName: "Foo", aliasNode: undefined, localName: "Foo" }`.
 */
function* iterateImportSpecs(importStmt: SgNode): Generator<ImportSpec> {
  const specs = importStmt.findAll({ rule: { kind: "import_specifier" } });
  for (const spec of specs) {
    const idents = spec.children().filter((c: SgNode) => c.kind() === "identifier");
    if (idents.length === 0) continue;
    const importedName = idents[0]!.text();
    const aliasNode = idents[1];
    yield {
      spec,
      importedName,
      aliasNode,
      localName: aliasNode?.text() ?? importedName,
    };
  }
}

function rebuildImportStatement(
  importStmt: SgNode,
  globalEmittedRenamed: Set<string>,
  unauthenticatedLocalNames: Set<string>,
  nullableInvokerAliasLocalNames: Set<string>,
  actorTypeAliasLocalNames: Set<string>,
): ImportRewriteResult {
  const importText = importStmt.text();
  const isImportType = /^\s*import\s+type\b/.test(importText);
  const trailingSemi = importText.trimEnd().endsWith(";") ? ";" : "";
  const sourceRaw = extractModuleSource(importText);

  const newSpecTexts: string[] = [];
  const seenLocal = new Set<string>();
  let touched = false;

  for (const { spec, importedName, aliasNode, localName } of iterateImportSpecs(importStmt)) {
    const specText = spec.text();
    const isTypeOnly = /^\s*type\s+/.test(specText);

    const renamed = TYPE_RENAME_MAP[importedName];
    if (renamed) {
      touched = true;
      const dropsAliasForNullableInvoker = importedName === "TailorInvoker" && !!aliasNode;
      const dropsAliasForActorType = importedName === "TailorActorType" && !!aliasNode;
      const dropsAliasForExpandedType = dropsAliasForNullableInvoker || dropsAliasForActorType;
      if (dropsAliasForNullableInvoker) nullableInvokerAliasLocalNames.add(localName);
      if (dropsAliasForActorType) actorTypeAliasLocalNames.add(localName);
      const finalLocal = dropsAliasForExpandedType ? renamed : (aliasNode?.text() ?? renamed);
      if (seenLocal.has(finalLocal)) continue;
      // Cross-statement dedupe for non-aliased renames so a file with
      // `import { TailorUser } from "@tailor-platform/sdk"` and
      // `import { TailorActor } from "@tailor-platform/sdk"` does not collapse to
      // two duplicate `import { TailorPrincipal } ...` lines.
      if ((!aliasNode || dropsAliasForExpandedType) && globalEmittedRenamed.has(renamed)) {
        continue;
      }
      seenLocal.add(finalLocal);
      if (!aliasNode || dropsAliasForExpandedType) globalEmittedRenamed.add(renamed);
      const asPart = aliasNode && !dropsAliasForExpandedType ? ` as ${aliasNode.text()}` : "";
      newSpecTexts.push(`${isTypeOnly ? "type " : ""}${renamed}${asPart}`);
    } else if (importedName === UNAUTHENTICATED) {
      touched = true;
      // Track the local binding so aliased forms like
      // `import { unauthenticatedTailorUser as testUser } ...` get their references
      // rewritten to `null` alongside the canonical name.
      unauthenticatedLocalNames.add(localName);
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
    newText: `${prefix}{ ${newSpecTexts.join(", ")} } from "${sourceRaw}"${trailingSemi}`,
    touched: true,
  };
}

const SCOPE_KINDS = new Set([
  "statement_block",
  "function_body",
  "for_statement",
  "for_in_statement",
  "for_of_statement",
  "arrow_function",
  "function_expression",
  "function_declaration",
  "method_definition",
]);

const NESTED_FN_KINDS = [
  "arrow_function",
  "function_expression",
  "function_declaration",
  "method_definition",
];

function isInsideAnyRange(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

/**
 * Walk up from `decl` and return the byte range of its enclosing scope, or
 * null if no recognized scope ancestor exists.
 */
function enclosingScopeRange(decl: SgNode): [number, number] | null {
  let scope: SgNode | null = decl.parent();
  while (scope && !SCOPE_KINDS.has(scope.kind())) scope = scope.parent();
  if (!scope) return null;
  const range = scope.range();
  return [range.start.index, range.end.index];
}

function patternBindsName(pat: SgNode, name: string): boolean {
  const k = pat.kind();
  if (k === "identifier") return pat.text() === name;
  if (k === "object_pattern") {
    for (const child of pat.children()) {
      const ck = child.kind();
      if (ck === "shorthand_property_identifier_pattern" && child.text() === name) return true;
      if (ck === "pair_pattern") {
        const value = child.field("value");
        if (value && patternBindsName(value, name)) return true;
      }
      if (ck === "object_assignment_pattern") {
        const inner = child
          .children()
          .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
        if (inner && inner.text() === name) return true;
      }
      if (ck === "rest_pattern") {
        const inner = child.children().find((c: SgNode) => c.kind() === "identifier");
        if (inner && inner.text() === name) return true;
      }
    }
  } else if (k === "array_pattern") {
    for (const child of pat.children()) {
      if (patternBindsName(child, name)) return true;
    }
  } else if (k === "assignment_pattern") {
    const left = pat.field("left");
    if (left && patternBindsName(left, name)) return true;
  }
  return false;
}

function hasNestedPropertyPattern(pat: SgNode, name: string): boolean {
  if (pat.kind() !== "object_pattern") return false;
  for (const child of pat.children()) {
    if (child.kind() !== "pair_pattern") continue;
    const key = child.field("key");
    if (key?.text() !== name) continue;
    if (child.field("value")?.kind() !== "identifier") return true;
  }
  return false;
}

function functionRebindsName(fn: SgNode, name: string): boolean {
  const single = fn.field("parameter");
  if (single && patternBindsName(single, name)) return true;
  const params =
    fn.field("parameters") ?? fn.children().find((c: SgNode) => c.kind() === "formal_parameters");
  if (!params) return false;
  for (const child of params.children()) {
    const k = child.kind();
    if (k === "identifier" && child.text() === name) return true;
    if (k === "object_pattern" || k === "array_pattern") {
      if (patternBindsName(child, name)) return true;
    }
    if (k === "required_parameter" || k === "optional_parameter") {
      const pat = child.field("pattern");
      if (pat && patternBindsName(pat, name)) return true;
    }
  }
  return false;
}

/**
 * Collect byte ranges of inner functions that re-bind `ctxName` as a parameter.
 *
 * Member-accesses to `ctxName.user` whose start byte falls inside any of these
 * ranges refer to the inner function's parameter, not the resolver context, and
 * must not be renamed.
 * @param body - The resolver body node.
 * @param ctxName - The context parameter identifier name.
 * @param resolverArrow - The resolver's outer arrow/function expression to exclude.
 */
function collectCtxShadowRanges(
  body: SgNode,
  ctxName: string,
  resolverArrow: SgNode,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const ar = resolverArrow.range();
  for (const k of NESTED_FN_KINDS) {
    const fns = body.findAll({ rule: { kind: k } });
    for (const fn of fns) {
      const r = fn.range();
      if (r.start.index === ar.start.index && r.end.index === ar.end.index) continue;
      if (functionRebindsName(fn, ctxName)) {
        ranges.push([r.start.index, r.end.index]);
      }
    }
  }
  // Also treat re-binding via `var ctx = ...` / `let ctx = ...` as a shadow.
  // We only check direct identifier-named declarators here — pattern-style
  // bindings (`const { ctx } = something`) that happen to share the name are
  // unrelated to the context parameter.
  const declarators = body.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    const nameNode = decl.field("name");
    if (!nameNode || nameNode.kind() !== "identifier") continue;
    if (nameNode.text() !== ctxName) continue;
    const range = enclosingScopeRange(decl);
    if (range) ranges.push(range);
  }
  return ranges;
}

/**
 * Collect every byte range across the file where `name` is locally re-bound,
 * so identifier references inside the range are treated as shadowed.
 *
 * Combines variable declarations (var/let/const, including object-pattern
 * shorthand declarations) with function-parameter bindings.
 */
function collectAllShadowRanges(root: SgNode, name: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // Field-precise scan over `variable_declarator` nodes — only the binding
  // pattern (`name` field) counts, not value-side identifier references.
  // `inside: { kind: "variable_declarator" }` would also match `user` in
  // `const x = user.id`, which would shadow the entire enclosing scope and
  // suppress every body rename.
  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    const nameNode = decl.field("name");
    if (!nameNode) continue;
    if (!patternBindsName(nameNode, name)) continue;
    const range = enclosingScopeRange(decl);
    if (range) ranges.push(range);
  }

  for (const k of NESTED_FN_KINDS) {
    const fns = root.findAll({ rule: { kind: k } });
    for (const fn of fns) {
      if (functionRebindsName(fn, name)) {
        const range = fn.range();
        ranges.push([range.start.index, range.end.index]);
      }
    }
  }
  return ranges;
}

function hasUnshadowedIdentifierReference(root: SgNode, name: string): boolean {
  const shadowRanges = collectAllShadowRanges(root, name);
  const refs = root.findAll({
    rule: { kind: "identifier", regex: `^${escapeRegex(name)}$` },
  });
  for (const ref of refs) {
    if (!isInsideAnyRange(ref.range().start.index, shadowRanges)) return true;
  }
  return false;
}

function hasPrincipalAssignmentTarget(root: SgNode, name: string): boolean {
  const shadowRanges = collectAllShadowRanges(root, name);
  const refs = root.findAll({
    rule: { kind: "identifier", regex: `^${escapeRegex(name)}$` },
  });
  for (const ref of refs) {
    const pos = ref.range().start.index;
    if (isInsideAnyRange(pos, shadowRanges)) continue;
    if (isAssignmentTargetReference(ref)) return true;
  }
  return false;
}

function rewriteParseArgumentShorthands(
  root: SgNode,
  localName: string,
  propertyName: string,
  parseContext: SdkFieldParseContext,
  edits: Edit[],
): void {
  const shadowRanges = collectAllShadowRanges(root, localName);
  const shortRefs = root.findAll({
    rule: { kind: "shorthand_property_identifier", regex: `^${escapeRegex(localName)}$` },
  });
  for (const ref of shortRefs) {
    const pos = ref.range().start.index;
    if (isInsideAnyRange(pos, shadowRanges)) continue;
    if (!isSdkFieldParseArgumentShorthand(ref, parseContext)) continue;
    edits.push(ref.replace(`${propertyName}: ${localName}`));
  }
}

interface PrincipalLocalBinding {
  name: string;
  bindingStart: number;
}

function guardPrincipalMemberAccesses(
  root: SgNode,
  binding: PrincipalLocalBinding,
  edits: Edit[],
): void {
  const refs = root.findAll({
    rule: { kind: "identifier", regex: `^${escapeRegex(binding.name)}$` },
  });
  for (const ref of refs) {
    if (!isOptionalizableMemberObject(ref)) continue;
    const pos = ref.range().start.index;
    if (isShadowedLocalReference(root, binding.name, pos, binding.bindingStart)) continue;
    edits.push(ref.replace(`${binding.name}?`));
  }

  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    const value = decl.field("value");
    if (!value || value.kind() !== "identifier" || value.text() !== binding.name) continue;
    if (!isObjectDestructureInitializer(value)) continue;
    const pos = value.range().start.index;
    if (isShadowedLocalReference(root, binding.name, pos, binding.bindingStart)) continue;
    edits.push(value.replace(`${binding.name} ?? {}`));
  }
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

function* iterateNamespaceImportLocalNames(importStmt: SgNode): Generator<string> {
  const namespaceImports = importStmt.findAll({ rule: { kind: "namespace_import" } });
  for (const namespaceImport of namespaceImports) {
    const localName = namespaceImport.children().find((c: SgNode) => c.kind() === "identifier");
    if (localName) yield localName.text();
  }
}

function isUnshadowedNamespaceObject(
  node: SgNode,
  namespaceNames: Set<string>,
  root: SgNode,
): boolean {
  if (node.kind() !== "identifier" || !namespaceNames.has(node.text())) return false;
  return !isInsideAnyRange(node.range().start.index, collectAllShadowRanges(root, node.text()));
}

function isSdkNamespaceQualifiedTypeIdentifier(
  typeId: SgNode,
  namespaceNames: Set<string>,
  root: SgNode,
): boolean {
  if (typeId.kind() !== "type_identifier") return false;
  const parent = typeId.parent();
  if (!parent || parent.kind() !== "nested_type_identifier") return false;
  const namespaceObject = parent.children().find((c: SgNode) => c.kind() === "identifier");
  return !!namespaceObject && isUnshadowedNamespaceObject(namespaceObject, namespaceNames, root);
}

function namespaceQualifiedTypeReplacement(
  typeId: SgNode,
  namespaceNames: Set<string>,
  root: SgNode,
): { target: SgNode; text: string } | null {
  if (typeId.kind() !== "type_identifier") return null;
  const parent = typeId.parent();
  if (!parent || parent.kind() !== "nested_type_identifier") return null;
  const namespaceObject = parent.children().find((c: SgNode) => c.kind() === "identifier");
  if (!namespaceObject || !isUnshadowedNamespaceObject(namespaceObject, namespaceNames, root)) {
    return null;
  }

  const namespace = namespaceObject.text();
  if (typeId.text() === "TailorInvoker") {
    return { target: parent, text: `(${namespace}.TailorPrincipal | null)` };
  }
  if (typeId.text() === "TailorActorType") {
    return { target: parent, text: `(${namespace}.TailorPrincipal["type"] | undefined)` };
  }
  const renamed = TYPE_RENAME_MAP[typeId.text()];
  return renamed ? { target: typeId, text: renamed } : null;
}

/**
 * Look for any binding named `caller` in the resolver body or pattern. When
 * one exists, renaming `user` → `caller` would either shadow it, collide with
 * a duplicate `let`/`const`, or alias an unrelated value, so the codemod
 * leaves the body alone for manual migration instead.
 */
function hasCallerBindingConflict(pattern: SgNode, body: SgNode): boolean {
  for (const child of pattern.children()) {
    const k = child.kind();
    if (k === "shorthand_property_identifier_pattern" && child.text() === "caller") return true;
    if (k === "pair_pattern") {
      // The property key can also collide: `{ user, caller: x }` after the
      // shorthand rename becomes `{ caller, caller: x }`, a duplicate key.
      const key = child.field("key");
      if (key && key.text() === "caller") return true;
      const value = child.field("value");
      if (value && value.kind() === "identifier" && value.text() === "caller") return true;
    }
    if (k === "object_assignment_pattern") {
      const inner = child
        .children()
        .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
      if (inner && inner.text() === "caller") return true;
    }
  }
  const decls = body.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of decls) {
    const nameNode = decl.field("name");
    if (nameNode && patternBindsName(nameNode, "caller")) return true;
  }
  const functionDecls = body.findAll({ rule: { kind: "function_declaration" } });
  for (const fn of functionDecls) {
    if (fn.field("name")?.text() === "caller") return true;
  }
  for (const k of NESTED_FN_KINDS) {
    const fns = body.findAll({ rule: { kind: k } });
    for (const fn of fns) {
      if (functionRebindsName(fn, "caller")) return true;
    }
  }
  return false;
}

function transformResolverBody(
  arrowNode: SgNode,
  edits: Edit[],
  parseContext: SdkFieldParseContext,
): void {
  const params =
    arrowNode.field("parameters") ??
    arrowNode.field("parameter") ??
    arrowNode.children().find((c: SgNode) => c.kind() === "formal_parameters");
  const body = arrowNode.field("body");
  if (!params || !body) return;

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

  let pattern: SgNode | undefined;
  if (firstParam.kind() === "object_pattern" || firstParam.kind() === "identifier") {
    pattern = firstParam;
  } else {
    const inner = firstParam.field("pattern");
    if (inner) pattern = inner;
  }
  if (!pattern) return;

  if (pattern.kind() === "object_pattern") {
    if (hasNestedPropertyPattern(pattern, "user")) return;
    if (hasPrincipalAssignmentTarget(body, "user")) return;
    if (hasCallerBindingConflict(pattern, body)) return;

    const aliasRenamedUser = hasUnshadowedIdentifierReference(body, "caller");
    let aliasedShorthandUser = false;
    let renamedShorthandUser = false;
    const principalAliasBindings: PrincipalLocalBinding[] = [];
    // Only iterate top-level pattern children so nested destructures like
    // `({ input: { user } })` are not mistaken for the resolver context user.
    for (const child of pattern.children()) {
      const kind = child.kind();
      if (kind === "shorthand_property_identifier_pattern" && child.text() === "user") {
        if (aliasRenamedUser) {
          edits.push(child.replace("caller: user"));
          aliasedShorthandUser = true;
          principalAliasBindings.push({
            name: "user",
            bindingStart: child.range().start.index,
          });
        } else {
          edits.push(child.replace("caller"));
          renamedShorthandUser = true;
        }
      } else if (kind === "pair_pattern") {
        const key = child.field("key");
        if (key && key.text() === "user") {
          edits.push(key.replace("caller"));
          const value = child.field("value");
          if (value?.kind() === "identifier") {
            principalAliasBindings.push({
              name: value.text(),
              bindingStart: value.range().start.index,
            });
          }
        }
      } else if (kind === "object_assignment_pattern") {
        // `{ user = fallback }` — the inner shorthand is the binding; default
        // expression is preserved.
        const inner = child
          .children()
          .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
        if (inner && inner.text() === "user") {
          if (aliasRenamedUser) {
            edits.push(inner.replace("caller: user"));
            aliasedShorthandUser = true;
            principalAliasBindings.push({
              name: "user",
              bindingStart: inner.range().start.index,
            });
          } else {
            edits.push(inner.replace("caller"));
            renamedShorthandUser = true;
          }
        }
      }
    }
    if (aliasedShorthandUser) {
      rewriteParseArgumentShorthands(body, "user", "invoker", parseContext, edits);
    }
    if (renamedShorthandUser) {
      // Use the broader shadow-range collector here so a nested arrow that
      // re-binds `user` as a parameter (e.g. `items.map((user) => user.id)`)
      // does not get its inner reference incorrectly renamed to `caller`.
      const shadowRanges = collectAllShadowRanges(body, "user");
      // Plain identifier references to the renamed binding (e.g. `user.id`).
      const refs = body.findAll({ rule: { kind: "identifier", regex: "^user$" } });
      for (const ref of refs) {
        const pos = ref.range().start.index;
        if (isInsideAnyRange(pos, shadowRanges)) continue;
        edits.push(ref.replace(principalIdentifierReplacement(ref, "caller")));
      }
      // Object literal shorthand (kind: `shorthand_property_identifier`, no
      // `_pattern` suffix) is both the key and the value. Rewriting it to
      // `caller` would silently change the resolver's output schema from a
      // `user` field to a `caller` field. Expand to `user: caller` instead so
      // the emitted shape stays the same while the value side reads from the
      // renamed local binding.
      const shortRefs = body.findAll({
        rule: { kind: "shorthand_property_identifier", regex: "^user$" },
      });
      for (const ref of shortRefs) {
        const pos = ref.range().start.index;
        if (isInsideAnyRange(pos, shadowRanges)) continue;
        edits.push(
          ref.replace(
            isSdkFieldParseArgumentShorthand(ref, parseContext)
              ? "invoker: caller"
              : "user: caller",
          ),
        );
      }
    }
    for (const binding of principalAliasBindings) {
      guardPrincipalMemberAccesses(body, binding, edits);
    }
    return;
  }

  // Single identifier param: rewrite `<ctx>.user` → `<ctx>.caller`, but skip
  // member accesses that sit inside a nested function which re-binds `<ctx>`.
  const ctxName = pattern.text();
  const ctxShadowRanges = collectCtxShadowRanges(body, ctxName, arrowNode);
  const propertyAccesses = body.findAll({
    rule: { kind: "property_identifier", regex: "^user$" },
  });
  for (const propId of propertyAccesses) {
    const parent = propId.parent();
    if (!parent || parent.kind() !== "member_expression") continue;
    const obj = parent.field("object");
    if (!(obj && obj.kind() === "identifier" && obj.text() === ctxName)) continue;
    const pos = obj.range().start.index;
    if (isInsideAnyRange(pos, ctxShadowRanges)) continue;
    edits.push(propId.replace(principalPropertyReplacement(propId, "caller")));
  }

  // Also rewrite destructures of the context, e.g. `const { user } = ctx;` →
  // `const { caller: user } = ctx;`. Local bindings stay the same so existing
  // body references keep working.
  const ctxDestructures = body.findAll({
    rule: {
      kind: "variable_declarator",
      has: {
        field: "value",
        kind: "identifier",
        regex: `^${escapeRegex(ctxName)}$`,
      },
    },
  });
  const principalAliasBindings: PrincipalLocalBinding[] = [];
  for (const decl of ctxDestructures) {
    const pos = decl.range().start.index;
    if (isInsideAnyRange(pos, ctxShadowRanges)) continue;
    const pat = decl.field("name");
    if (!pat || pat.kind() !== "object_pattern") continue;
    for (const child of pat.children()) {
      const k = child.kind();
      if (k === "shorthand_property_identifier_pattern" && child.text() === "user") {
        edits.push(child.replace("caller: user"));
        principalAliasBindings.push({
          name: "user",
          bindingStart: child.range().start.index,
        });
      } else if (k === "pair_pattern") {
        const key = child.field("key");
        const value = child.field("value");
        if (key && key.text() === "user" && value?.kind() === "identifier") {
          edits.push(key.replace("caller"));
          principalAliasBindings.push({
            name: value.text(),
            bindingStart: value.range().start.index,
          });
        }
      }
    }
  }
  for (const binding of principalAliasBindings) {
    guardPrincipalMemberAccesses(body, binding, edits);
  }
}

function findMemberCallName(call: SgNode): string | null {
  const fn = call.field("function");
  if (!fn || fn.kind() !== "member_expression") return null;
  const property = fn.field("property");
  return property?.text() ?? null;
}

function findMemberCallObject(call: SgNode): SgNode | null {
  const fn = call.field("function");
  if (!fn || fn.kind() !== "member_expression") return null;
  return fn.field("object");
}

function isFunctionNode(node: SgNode): boolean {
  return (
    node.kind() === "arrow_function" ||
    node.kind() === "function_declaration" ||
    node.kind() === "function_expression" ||
    node.kind() === "method_definition"
  );
}

function propertyName(node: SgNode): string | null {
  return node.field("key")?.text() ?? node.field("name")?.text() ?? null;
}

function getFirstFunctionParam(fn: SgNode): SgNode | null {
  const params =
    fn.field("parameters") ??
    fn.field("parameter") ??
    fn.children().find((c: SgNode) => c.kind() === "formal_parameters");
  if (!params) return null;
  if (params.kind() === "object_pattern" || params.kind() === "identifier") {
    return params;
  }

  return (
    params
      .children()
      .find(
        (c: SgNode) =>
          c.kind() === "required_parameter" ||
          c.kind() === "optional_parameter" ||
          c.kind() === "identifier" ||
          c.kind() === "object_pattern",
      ) ?? null
  );
}

function getFunctionParamPattern(param: SgNode): SgNode | null {
  if (param.kind() === "object_pattern" || param.kind() === "identifier") return param;
  return param.field("pattern");
}

function findExecutorBodyFunctions(call: SgNode): SgNode[] {
  const args = call.field("arguments");
  const objArg = args?.children().find((c: SgNode) => c.kind() === "object");
  if (!objArg) return [];

  const functions: SgNode[] = [];
  const visitObject = (object: SgNode): void => {
    for (const child of object.children()) {
      if (child.kind() === "method_definition") {
        if (propertyName(child) === "body") functions.push(child);
        continue;
      }
      if (child.kind() !== "pair") continue;

      const value = child.field("value");
      if (!value) continue;
      if (child.field("key")?.text() === "body" && isFunctionNode(value)) {
        functions.push(value);
      } else if (value.kind() === "object") {
        visitObject(value);
      }
    }
  };

  visitObject(objArg);
  return functions;
}

function transformExecutorBodyActorAccesses(
  fn: SgNode,
  edits: Edit[],
  transformedActorPropertyStarts: Set<number>,
): void {
  const param = getFirstFunctionParam(fn);
  const pattern = param ? getFunctionParamPattern(param) : null;
  const body = fn.field("body");
  if (!pattern || !body) return;

  if (pattern.kind() === "identifier") {
    const ctxName = pattern.text();
    const ctxShadowRanges = collectCtxShadowRanges(body, ctxName, fn);
    transformExecutorCtxActorAccesses(
      body,
      ctxName,
      ctxShadowRanges,
      edits,
      transformedActorPropertyStarts,
    );
    return;
  }

  if (pattern.kind() !== "object_pattern") return;

  for (const child of pattern.children()) {
    const kind = child.kind();
    if (kind === "shorthand_property_identifier_pattern" && child.text() === "actor") {
      transformActorBindingMemberAccesses(
        body,
        { name: "actor", bindingStart: child.range().start.index },
        edits,
        transformedActorPropertyStarts,
      );
    } else if (kind === "pair_pattern") {
      const key = child.field("key");
      const value = child.field("value");
      if (key?.text() === "actor" && value?.kind() === "identifier") {
        transformActorBindingMemberAccesses(
          body,
          { name: value.text(), bindingStart: value.range().start.index },
          edits,
          transformedActorPropertyStarts,
        );
      }
    }
  }
}

interface LocalCallbackTypeBinding {
  name: string;
  declaration: SgNode;
  bindingStart: number;
  scope: [number, number];
}

interface CallbackTypeContext {
  bindings: LocalCallbackTypeBinding[];
  transformedTypeStarts: Set<number>;
  transformedPrincipalTypeStarts: Set<number>;
  tailorUserTypeLocalNames: Set<string>;
  sdkNamespaceNames: Set<string>;
  sdkFieldRootNames: Set<string>;
  sdkFieldLocalBindings: SdkFieldLocalBinding[];
  root: SgNode;
}

function nullableTailorUserTypeReplacement(
  typeId: SgNode,
  typeContext: CallbackTypeContext,
): string | null {
  if (typeContext.tailorUserTypeLocalNames.has(typeId.text())) {
    return typeId.text() === "TailorUser" ? "TailorPrincipal | null" : `${typeId.text()} | null`;
  }
  return isSdkNamespaceQualifiedTypeIdentifier(
    typeId,
    typeContext.sdkNamespaceNames,
    typeContext.root,
  )
    ? "TailorPrincipal | null"
    : null;
}

function transformObjectTypeUserProperty(
  objectType: SgNode,
  edits: Edit[],
  typeContext: CallbackTypeContext,
): void {
  for (const child of objectType.children()) {
    if (child.kind() !== "property_signature") continue;
    const name = child.field("name");
    if (name?.text() !== "user") continue;
    edits.push(name.replace("invoker"));

    const typeAnnotation = child.field("type");
    if (!typeAnnotation || /\bnull\b/.test(typeAnnotation.text())) continue;
    const typeIds = typeAnnotation.findAll({ rule: { kind: "type_identifier" } });
    for (const typeId of typeIds) {
      const replacement = nullableTailorUserTypeReplacement(typeId, typeContext);
      if (!replacement) continue;
      typeContext.transformedPrincipalTypeStarts.add(typeId.range().start.index);
      edits.push(typeId.replace(replacement));
    }
  }
}

function localCallbackTypeObject(declaration: SgNode): SgNode | null {
  return (
    declaration
      .children()
      .find((c: SgNode) => c.kind() === "object_type" || c.kind() === "interface_body") ?? null
  );
}

function collectLocalCallbackTypeBindings(root: SgNode): LocalCallbackTypeBinding[] {
  const rootScope = localBindingRootScope(root);
  const bindings: LocalCallbackTypeBinding[] = [];

  for (const kind of ["type_alias_declaration", "interface_declaration"]) {
    const declarations = root.findAll({ rule: { kind } });
    for (const declaration of declarations) {
      if (!localCallbackTypeObject(declaration)) continue;
      const name = declaration.field("name");
      if (!name || (name.kind() !== "type_identifier" && name.kind() !== "identifier")) continue;
      bindings.push({
        name: name.text(),
        declaration,
        bindingStart: name.range().start.index,
        scope: enclosingScopeRange(declaration) ?? rootScope,
      });
    }
  }

  return bindings;
}

function isShadowedLocalTypeReference(
  root: SgNode,
  name: string,
  pos: number,
  bindingStart: number,
): boolean {
  for (const kind of ["type_alias_declaration", "interface_declaration"]) {
    const declarations = root.findAll({ rule: { kind } });
    for (const declaration of declarations) {
      const nameNode = declaration.field("name");
      if (!nameNode || nameNode.text() !== name) continue;
      if (nameNode.range().start.index === bindingStart) continue;
      const scope = enclosingScopeRange(declaration);
      if (scope && rangeContains(scope, pos)) return true;
    }
  }
  return false;
}

function resolveLocalCallbackTypeBinding(
  node: SgNode,
  context: CallbackTypeContext,
): LocalCallbackTypeBinding | null {
  const pos = node.range().start.index;
  return (
    context.bindings.find(
      (binding) =>
        binding.name === node.text() &&
        rangeContains(binding.scope, pos) &&
        !isShadowedLocalTypeReference(context.root, binding.name, pos, binding.bindingStart),
    ) ?? null
  );
}

function transformNamedPrincipalCallbackType(
  typeName: SgNode,
  edits: Edit[],
  context: CallbackTypeContext,
): void {
  const binding = resolveLocalCallbackTypeBinding(typeName, context);
  if (!binding) return;

  const start = binding.declaration.range().start.index;
  if (context.transformedTypeStarts.has(start)) return;

  const objectType = localCallbackTypeObject(binding.declaration);
  if (!objectType) return;
  context.transformedTypeStarts.add(start);
  transformObjectTypeUserProperty(objectType, edits, context);
}

function transformPrincipalCallbackParamType(
  param: SgNode,
  edits: Edit[],
  typeContext?: CallbackTypeContext,
): void {
  const typeAnnotation = param.field("type");
  const objectType = typeAnnotation?.children().find((c: SgNode) => c.kind() === "object_type");
  if (objectType) {
    if (typeContext) {
      transformObjectTypeUserProperty(objectType, edits, typeContext);
    }
    return;
  }

  const typeName = typeAnnotation?.children().find((c: SgNode) => c.kind() === "type_identifier");
  if (typeName && typeContext) transformNamedPrincipalCallbackType(typeName, edits, typeContext);
}

function transformPrincipalCallbackParam(
  fn: SgNode,
  edits: Edit[],
  typeContext?: CallbackTypeContext,
): void {
  const param = getFirstFunctionParam(fn);
  if (!param) return;
  const pattern = getFunctionParamPattern(param);
  const body = fn.field("body");
  if (!pattern || !body) return;

  if (pattern.kind() === "identifier") {
    const ctxName = pattern.text();
    const ctxShadowRanges = collectCtxShadowRanges(body, ctxName, fn);
    const propertyAccesses = body.findAll({
      rule: { kind: "property_identifier", regex: "^user$" },
    });
    for (const propId of propertyAccesses) {
      const parent = propId.parent();
      if (!parent || parent.kind() !== "member_expression") continue;
      const obj = parent.field("object");
      if (!(obj && obj.kind() === "identifier" && obj.text() === ctxName)) continue;
      const pos = obj.range().start.index;
      if (isInsideAnyRange(pos, ctxShadowRanges)) continue;
      edits.push(propId.replace(principalPropertyReplacement(propId, "invoker")));
    }

    const ctxDestructures = body.findAll({
      rule: {
        kind: "variable_declarator",
        has: {
          field: "value",
          kind: "identifier",
          regex: `^${escapeRegex(ctxName)}$`,
        },
      },
    });
    const principalAliasBindings: PrincipalLocalBinding[] = [];
    for (const decl of ctxDestructures) {
      const pos = decl.range().start.index;
      if (isInsideAnyRange(pos, ctxShadowRanges)) continue;
      const pat = decl.field("name");
      if (!pat || pat.kind() !== "object_pattern") continue;
      for (const child of pat.children()) {
        const kind = child.kind();
        if (kind === "shorthand_property_identifier_pattern" && child.text() === "user") {
          edits.push(child.replace("invoker: user"));
          principalAliasBindings.push({
            name: "user",
            bindingStart: child.range().start.index,
          });
        } else if (kind === "pair_pattern") {
          const key = child.field("key");
          const value = child.field("value");
          if (key?.text() === "user" && value?.kind() === "identifier") {
            edits.push(key.replace("invoker"));
            principalAliasBindings.push({
              name: value.text(),
              bindingStart: value.range().start.index,
            });
          }
        }
      }
    }
    for (const binding of principalAliasBindings) {
      guardPrincipalMemberAccesses(body, binding, edits);
    }
    transformPrincipalCallbackParamType(param, edits, typeContext);
    return;
  }

  if (pattern.kind() !== "object_pattern") return;
  if (hasNestedPropertyPattern(pattern, "user")) return;

  let hasUserParamProperty = false;
  let renamesBinding = false;
  const principalAliasBindings: PrincipalLocalBinding[] = [];
  for (const child of pattern.children()) {
    const kind = child.kind();
    if (kind === "shorthand_property_identifier_pattern" && child.text() === "user") {
      hasUserParamProperty = true;
      renamesBinding = true;
    } else if (kind === "pair_pattern") {
      const key = child.field("key");
      if (key?.text() === "user") {
        hasUserParamProperty = true;
        const value = child.field("value");
        if (value?.kind() === "identifier") {
          principalAliasBindings.push({
            name: value.text(),
            bindingStart: value.range().start.index,
          });
        }
      }
    } else if (kind === "object_assignment_pattern") {
      const inner = child
        .children()
        .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
      if (inner?.text() === "user") {
        hasUserParamProperty = true;
        renamesBinding = true;
      }
    }
  }

  if (!hasUserParamProperty) return;
  if (renamesBinding && hasPrincipalAssignmentTarget(body, "user")) return;
  if (renamesBinding && patternBindsName(pattern, "invoker")) return;
  transformPrincipalCallbackParamType(param, edits, typeContext);

  const aliasRenamedUser =
    renamesBinding &&
    (collectAllShadowRanges(body, "invoker").length > 0 ||
      hasUnshadowedIdentifierReference(body, "invoker"));

  let aliasedShorthandUser = false;
  let renamedShorthandUser = false;
  for (const child of pattern.children()) {
    const kind = child.kind();
    if (kind === "shorthand_property_identifier_pattern" && child.text() === "user") {
      if (aliasRenamedUser) {
        edits.push(child.replace("invoker: user"));
        aliasedShorthandUser = true;
        principalAliasBindings.push({
          name: "user",
          bindingStart: child.range().start.index,
        });
      } else {
        edits.push(child.replace("invoker"));
        renamedShorthandUser = true;
      }
    } else if (kind === "pair_pattern") {
      const key = child.field("key");
      if (key?.text() === "user") {
        edits.push(key.replace("invoker"));
      }
    } else if (kind === "object_assignment_pattern") {
      const inner = child
        .children()
        .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
      if (inner?.text() === "user") {
        if (aliasRenamedUser) {
          edits.push(inner.replace("invoker: user"));
          aliasedShorthandUser = true;
          principalAliasBindings.push({
            name: "user",
            bindingStart: inner.range().start.index,
          });
        } else {
          edits.push(inner.replace("invoker"));
          renamedShorthandUser = true;
        }
      }
    }
  }

  if (!renamedShorthandUser) {
    if (aliasedShorthandUser) {
      rewriteParseArgumentShorthands(body, "user", "invoker", typeContext, edits);
    }
    for (const binding of principalAliasBindings) {
      guardPrincipalMemberAccesses(body, binding, edits);
    }
    return;
  }

  const shadowRanges = collectAllShadowRanges(body, "user");
  const refs = body.findAll({ rule: { kind: "identifier", regex: "^user$" } });
  for (const ref of refs) {
    const pos = ref.range().start.index;
    if (isInsideAnyRange(pos, shadowRanges)) continue;
    edits.push(ref.replace(principalReadReplacement(ref, "invoker")));
  }

  const shortRefs = body.findAll({
    rule: { kind: "shorthand_property_identifier", regex: "^user$" },
  });
  for (const ref of shortRefs) {
    const pos = ref.range().start.index;
    if (isInsideAnyRange(pos, shadowRanges)) continue;
    edits.push(
      ref.replace(isSdkFieldParseArgumentShorthand(ref, typeContext) ? "invoker" : "user: invoker"),
    );
  }

  for (const binding of principalAliasBindings) {
    guardPrincipalMemberAccesses(body, binding, edits);
  }
}

interface SdkFieldLocalBinding {
  name: string;
  bindingStart: number;
  scope: [number, number];
}

function rangeContains([start, end]: [number, number], pos: number): boolean {
  return pos >= start && pos < end;
}

function isShadowedLocalReference(
  root: SgNode,
  name: string,
  pos: number,
  bindingStart: number,
): boolean {
  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    const nameNode = decl.field("name");
    if (!nameNode || !patternBindsName(nameNode, name)) continue;
    const nameRange = nameNode.range();
    if (bindingStart >= nameRange.start.index && bindingStart < nameRange.end.index) continue;
    const scope = enclosingScopeRange(decl);
    if (scope && rangeContains(scope, pos)) return true;
  }

  const functionDecls = root.findAll({ rule: { kind: "function_declaration" } });
  for (const fn of functionDecls) {
    const nameNode = fn.field("name");
    if (!nameNode || nameNode.text() !== name) continue;
    if (nameNode.range().start.index === bindingStart) continue;
    const scope = enclosingScopeRange(fn);
    if (scope && rangeContains(scope, pos)) return true;
  }

  for (const kind of NESTED_FN_KINDS) {
    const fns = root.findAll({ rule: { kind } });
    for (const fn of fns) {
      if (!functionRebindsName(fn, name)) continue;
      const range = fn.range();
      if (pos >= range.start.index && pos < range.end.index) return true;
    }
  }

  return false;
}

function resolvesToSdkFieldLocal(
  node: SgNode,
  bindings: SdkFieldLocalBinding[],
  root: SgNode,
): boolean {
  if (node.kind() !== "identifier") return false;
  const pos = node.range().start.index;
  return bindings.some(
    (binding) =>
      binding.name === node.text() &&
      rangeContains(binding.scope, pos) &&
      !isShadowedLocalReference(root, binding.name, pos, binding.bindingStart),
  );
}

function isSdkFieldExpression(
  node: SgNode,
  sdkFieldRootNames: Set<string>,
  sdkFieldLocalBindings: SdkFieldLocalBinding[],
  root: SgNode,
): boolean {
  if (node.kind() === "identifier") {
    const pos = node.range().start.index;
    const isSdkRoot =
      sdkFieldRootNames.has(node.text()) &&
      !isInsideAnyRange(pos, collectAllShadowRanges(root, node.text()));
    return isSdkRoot || resolvesToSdkFieldLocal(node, sdkFieldLocalBindings, root);
  }
  if (node.kind() === "member_expression") {
    const object = node.field("object");
    return object
      ? isSdkFieldExpression(object, sdkFieldRootNames, sdkFieldLocalBindings, root)
      : false;
  }
  if (node.kind() === "call_expression") {
    const object = findMemberCallObject(node);
    return object
      ? isSdkFieldExpression(object, sdkFieldRootNames, sdkFieldLocalBindings, root)
      : false;
  }
  return false;
}

function collectSdkFieldLocalBindings(
  root: SgNode,
  sdkFieldRootNames: Set<string>,
): SdkFieldLocalBinding[] {
  const bindings: SdkFieldLocalBinding[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
    for (const decl of declarators) {
      const name = decl.field("name");
      const value = decl.field("value");
      if (!name || name.kind() !== "identifier" || !value) continue;
      const bindingStart = name.range().start.index;
      if (bindings.some((binding) => binding.bindingStart === bindingStart)) continue;
      if (!isSdkFieldExpression(value, sdkFieldRootNames, bindings, root)) continue;
      const rootRange = root.range();
      const scope = enclosingScopeRange(decl) ?? [rootRange.start.index, rootRange.end.index];
      bindings.push({ name: name.text(), bindingStart, scope });
      changed = true;
    }
  }
  return bindings;
}

function isSdkFieldMemberCall(
  call: SgNode,
  sdkFieldRootNames: Set<string>,
  sdkFieldLocalBindings: SdkFieldLocalBinding[],
  root: SgNode,
): boolean {
  const object = findMemberCallObject(call);
  return object
    ? isSdkFieldExpression(object, sdkFieldRootNames, sdkFieldLocalBindings, root)
    : false;
}

function collectSdkFieldRootNames(root: SgNode): Set<string> {
  const sdkFieldRootNames = new Set<string>();
  const sdkImports = root.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: "^[\"']@tailor-platform/sdk(/test)?[\"']$" },
    },
  });
  for (const importStmt of sdkImports) {
    for (const namespaceName of iterateNamespaceImportLocalNames(importStmt)) {
      sdkFieldRootNames.add(namespaceName);
    }
    for (const { importedName, localName } of iterateImportSpecs(importStmt)) {
      if (importedName === "t" || importedName === "db") {
        sdkFieldRootNames.add(localName);
      }
    }
  }
  return sdkFieldRootNames;
}

interface LocalCallbackBinding {
  name: string;
  fn: SgNode;
  bindingStart: number;
  scope: [number, number];
}

interface LocalObjectBinding {
  name: string;
  object: SgNode;
  bindingStart: number;
  scope: [number, number];
}

function localBindingRootScope(root: SgNode): [number, number] {
  const rootRange = root.range();
  return [rootRange.start.index, rootRange.end.index];
}

function collectLocalCallbackBindings(root: SgNode): LocalCallbackBinding[] {
  const rootScope = localBindingRootScope(root);
  const bindings: LocalCallbackBinding[] = [];

  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    const name = decl.field("name");
    const value = decl.field("value");
    if (!name || name.kind() !== "identifier" || !value || !isFunctionNode(value)) continue;
    bindings.push({
      name: name.text(),
      fn: value,
      bindingStart: name.range().start.index,
      scope: enclosingScopeRange(decl) ?? rootScope,
    });
  }

  const functionDecls = root.findAll({ rule: { kind: "function_declaration" } });
  for (const fn of functionDecls) {
    const name = fn.field("name");
    if (!name || name.kind() !== "identifier") continue;
    bindings.push({
      name: name.text(),
      fn,
      bindingStart: name.range().start.index,
      scope: enclosingScopeRange(fn) ?? rootScope,
    });
  }

  return bindings;
}

function collectLocalObjectBindings(root: SgNode): LocalObjectBinding[] {
  const rootScope = localBindingRootScope(root);
  const bindings: LocalObjectBinding[] = [];

  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    const name = decl.field("name");
    const value = decl.field("value");
    if (!name || name.kind() !== "identifier" || value?.kind() !== "object") continue;
    bindings.push({
      name: name.text(),
      object: value,
      bindingStart: name.range().start.index,
      scope: enclosingScopeRange(decl) ?? rootScope,
    });
  }

  return bindings;
}

function resolveLocalCallbackBinding(
  node: SgNode,
  bindings: LocalCallbackBinding[],
  root: SgNode,
): LocalCallbackBinding | null {
  if (node.kind() !== "identifier") return null;
  const pos = node.range().start.index;
  return (
    bindings.find(
      (binding) =>
        binding.name === node.text() &&
        rangeContains(binding.scope, pos) &&
        !isShadowedLocalReference(root, binding.name, pos, binding.bindingStart),
    ) ?? null
  );
}

function resolveLocalObjectBinding(
  node: SgNode,
  bindings: LocalObjectBinding[],
  root: SgNode,
): LocalObjectBinding | null {
  if (node.kind() !== "identifier") return null;
  const pos = node.range().start.index;
  return (
    bindings.find(
      (binding) =>
        binding.name === node.text() &&
        rangeContains(binding.scope, pos) &&
        !isShadowedLocalReference(root, binding.name, pos, binding.bindingStart),
    ) ?? null
  );
}

function transformPrincipalCallbackNode(
  node: SgNode,
  edits: Edit[],
  callbackBindings: LocalCallbackBinding[],
  transformedCallbackStarts: Set<number>,
  typeContext: CallbackTypeContext,
  root: SgNode,
): boolean {
  if (isFunctionNode(node)) {
    transformPrincipalCallbackParam(node, edits, typeContext);
    return true;
  }

  const binding = resolveLocalCallbackBinding(node, callbackBindings, root);
  if (!binding) return false;

  const start = binding.fn.range().start.index;
  if (!transformedCallbackStarts.has(start)) {
    transformedCallbackStarts.add(start);
    transformPrincipalCallbackParam(binding.fn, edits, typeContext);
  }
  return true;
}

function transformHookCallbackObject(
  node: SgNode,
  edits: Edit[],
  callbackBindings: LocalCallbackBinding[],
  transformedCallbackStarts: Set<number>,
  typeContext: CallbackTypeContext,
  root: SgNode,
): void {
  if (node.kind() !== "object") return;
  for (const child of node.children()) {
    if (child.kind() === "method_definition") {
      const key = propertyName(child);
      if (key === "create" || key === "update") {
        transformPrincipalCallbackParam(child, edits, typeContext);
      }
      continue;
    }
    if (child.kind() !== "pair") continue;
    const key = child.field("key")?.text();
    const value = child.field("value");
    if (!value) continue;
    if (key === "create" || key === "update") {
      const transformed = transformPrincipalCallbackNode(
        value,
        edits,
        callbackBindings,
        transformedCallbackStarts,
        typeContext,
        root,
      );
      if (!transformed && value.kind() === "object") {
        transformHookCallbackObject(
          value,
          edits,
          callbackBindings,
          transformedCallbackStarts,
          typeContext,
          root,
        );
      }
    } else if (value.kind() === "object") {
      transformHookCallbackObject(
        value,
        edits,
        callbackBindings,
        transformedCallbackStarts,
        typeContext,
        root,
      );
    }
  }
}

function transformHookCallbackConfigNode(
  node: SgNode,
  edits: Edit[],
  callbackBindings: LocalCallbackBinding[],
  objectBindings: LocalObjectBinding[],
  transformedCallbackStarts: Set<number>,
  transformedObjectStarts: Set<number>,
  typeContext: CallbackTypeContext,
  root: SgNode,
): boolean {
  if (node.kind() === "object") {
    transformHookCallbackObject(
      node,
      edits,
      callbackBindings,
      transformedCallbackStarts,
      typeContext,
      root,
    );
    return true;
  }

  const binding = resolveLocalObjectBinding(node, objectBindings, root);
  if (!binding) return false;

  const start = binding.object.range().start.index;
  if (!transformedObjectStarts.has(start)) {
    transformedObjectStarts.add(start);
    transformHookCallbackObject(
      binding.object,
      edits,
      callbackBindings,
      transformedCallbackStarts,
      typeContext,
      root,
    );
  }
  return true;
}

function transformValidateCallbackNode(
  node: SgNode,
  edits: Edit[],
  callbackBindings: LocalCallbackBinding[],
  transformedCallbackStarts: Set<number>,
  typeContext: CallbackTypeContext,
  root: SgNode,
): void {
  if (
    transformPrincipalCallbackNode(
      node,
      edits,
      callbackBindings,
      transformedCallbackStarts,
      typeContext,
      root,
    )
  ) {
    return;
  }

  if (node.kind() === "array") {
    for (const child of node.children()) {
      transformValidateCallbackNode(
        child,
        edits,
        callbackBindings,
        transformedCallbackStarts,
        typeContext,
        root,
      );
    }
    return;
  }

  if (node.kind() !== "object") return;
  for (const child of node.children()) {
    if (child.kind() === "method_definition") {
      transformPrincipalCallbackParam(child, edits, typeContext);
      continue;
    }
    if (child.kind() !== "pair") continue;
    const value = child.field("value");
    if (value) {
      transformValidateCallbackNode(
        value,
        edits,
        callbackBindings,
        transformedCallbackStarts,
        typeContext,
        root,
      );
    }
  }
}

function transformPrincipalCallbacksInCall(
  call: SgNode,
  edits: Edit[],
  sdkFieldRootNames: Set<string>,
  sdkFieldLocalBindings: SdkFieldLocalBinding[],
  callbackBindings: LocalCallbackBinding[],
  objectBindings: LocalObjectBinding[],
  transformedCallbackStarts: Set<number>,
  transformedObjectStarts: Set<number>,
  typeContext: CallbackTypeContext,
  root: SgNode,
): void {
  const memberName = findMemberCallName(call);
  if (memberName !== "hooks" && memberName !== "validate") return;
  if (!isSdkFieldMemberCall(call, sdkFieldRootNames, sdkFieldLocalBindings, root)) return;

  const args = call.field("arguments");
  if (!args) return;
  if (memberName === "hooks") {
    for (const arg of args.children()) {
      if (
        transformHookCallbackConfigNode(
          arg,
          edits,
          callbackBindings,
          objectBindings,
          transformedCallbackStarts,
          transformedObjectStarts,
          typeContext,
          root,
        )
      ) {
        break;
      }
    }
    return;
  }

  for (const arg of args.children()) {
    transformValidateCallbackNode(
      arg,
      edits,
      callbackBindings,
      transformedCallbackStarts,
      typeContext,
      root,
    );
  }
}

function transformParseArgsObject(
  call: SgNode,
  edits: Edit[],
  sdkFieldRootNames: Set<string>,
  sdkFieldLocalBindings: SdkFieldLocalBinding[],
  root: SgNode,
): void {
  const memberName = findMemberCallName(call);
  if (memberName !== "parse") return;
  if (!isSdkFieldMemberCall(call, sdkFieldRootNames, sdkFieldLocalBindings, root)) return;

  const args = call.field("arguments");
  const objArg = args?.children().find((c: SgNode) => c.kind() === "object");
  if (!objArg) return;

  for (const child of objArg.children()) {
    const kind = child.kind();
    if (kind === "pair") {
      const key = child.field("key");
      if (key?.text() === "user") edits.push(key.replace("invoker"));
    } else if (kind === "shorthand_property_identifier" && child.text() === "user") {
      edits.push(child.replace("invoker: user"));
    }
  }
}

const KYSELY_PREDICATE_METHODS = new Set(["where", "having", "on"]);

function excerptForLine(source: string, line: number): string {
  const excerpt = (source.split(/\r?\n/)[line - 1] ?? "").trim();
  return excerpt.length > 160 ? `${excerpt.slice(0, 157)}...` : excerpt;
}

function addReviewFinding(
  findings: LlmReviewFinding[],
  seen: Set<string>,
  source: string,
  file: string,
  node: SgNode,
  message: string,
): void {
  const line = node.range().start.line + 1;
  const excerpt = excerptForLine(source, line);
  const key = `${file}:${line}:${message}:${excerpt}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ file, line, message, excerpt });
}

interface ReviewPrincipalBinding {
  name: string;
  bindingStart: number;
  scope: [number, number];
  shadowRoot?: SgNode;
}

function resolvesToReviewBinding(
  node: SgNode,
  bindings: ReviewPrincipalBinding[],
  root: SgNode,
): boolean {
  if (node.kind() !== "identifier") return false;
  const pos = node.range().start.index;
  return bindings.some((binding) => {
    if (binding.name !== node.text() || !rangeContains(binding.scope, pos)) return false;
    if (binding.shadowRoot) {
      return !isInsideAnyRange(pos, collectAllShadowRanges(binding.shadowRoot, binding.name));
    }
    return !isShadowedLocalReference(root, binding.name, pos, binding.bindingStart);
  });
}

function resolvesToReviewPrincipalBinding(
  node: SgNode,
  bindings: ReviewPrincipalBinding[],
  root: SgNode,
): boolean {
  return resolvesToReviewBinding(node, bindings, root);
}

function isReviewContextCallerMemberExpression(
  node: SgNode,
  contextBindings: ReviewPrincipalBinding[],
  root: SgNode,
): boolean {
  if (node.kind() !== "member_expression") return false;
  if (node.field("property")?.text() !== "caller") return false;
  const object = node.field("object");
  return object ? resolvesToReviewBinding(object, contextBindings, root) : false;
}

function isPrincipalOptionalMemberExpression(
  node: SgNode,
  principalBindings: ReviewPrincipalBinding[],
  contextBindings: ReviewPrincipalBinding[],
  root: SgNode,
): boolean {
  if (node.kind() !== "member_expression") return false;
  if (!node.children().some((child) => child.kind() === "optional_chain")) return false;
  const object = node.field("object");
  if (!object) return false;
  if (object.kind() === "identifier") {
    return resolvesToReviewPrincipalBinding(object, principalBindings, root);
  }
  return isReviewContextCallerMemberExpression(object, contextBindings, root);
}

function isDirectPrincipalExpression(
  node: SgNode,
  principalBindings: ReviewPrincipalBinding[],
  contextBindings: ReviewPrincipalBinding[],
  root: SgNode,
): boolean {
  if (resolvesToReviewPrincipalBinding(node, principalBindings, root)) return true;
  return isReviewContextCallerMemberExpression(node, contextBindings, root);
}

function nodeContainsArgumentPrincipalOptionalAccess(
  node: SgNode,
  principalBindings: ReviewPrincipalBinding[],
  contextBindings: ReviewPrincipalBinding[],
  safePrincipalRanges: Array<[number, number]>,
  root: SgNode,
): boolean {
  if (isInsideAnyRange(node.range().start.index, safePrincipalRanges)) return false;
  if (isFunctionNode(node)) return false;
  if (isDirectPrincipalExpression(node, principalBindings, contextBindings, root)) return true;
  if (isPrincipalOptionalMemberExpression(node, principalBindings, contextBindings, root))
    return true;
  return node
    .children()
    .some((child) =>
      nodeContainsArgumentPrincipalOptionalAccess(
        child,
        principalBindings,
        contextBindings,
        safePrincipalRanges,
        root,
      ),
    );
}

function reviewCallName(call: SgNode): string {
  const fn = call.field("function");
  if (!fn) return "a call";
  if (fn.kind() === "identifier") return `${fn.text()}()`;
  if (fn.kind() === "member_expression") {
    const property = fn.field("property");
    if (property) return `${property.text()}()`;
  }
  return "a call";
}

function collectParseInvokerValueRanges(call: SgNode): Array<[number, number]> {
  const args = call.field("arguments");
  const objectArg = args?.children().find((child) => child.kind() === "object");
  if (!objectArg) return [];

  const ranges: Array<[number, number]> = [];
  for (const child of objectArg.children()) {
    if (child.kind() === "shorthand_property_identifier" && child.text() === "invoker") {
      const range = child.range();
      ranges.push([range.start.index, range.end.index]);
      continue;
    }

    if (child.kind() !== "pair") continue;
    const key = child.field("key");
    if (key?.text() !== "invoker") continue;
    const value = child.field("value");
    if (!value) continue;
    const range = value.range();
    ranges.push([range.start.index, range.end.index]);
  }
  return ranges;
}

function collectSafeNullablePrincipalArgumentRanges(
  call: SgNode,
  sdkFieldRootNames: Set<string>,
  sdkFieldLocalBindings: SdkFieldLocalBinding[],
  root: SgNode,
): Array<[number, number]> {
  if (findMemberCallName(call) !== "parse") return [];
  if (!isSdkFieldMemberCall(call, sdkFieldRootNames, sdkFieldLocalBindings, root)) return [];
  return collectParseInvokerValueRanges(call);
}

function collectNullableCallerReviewFindings(
  root: SgNode,
  source: string,
  file: string,
  principalBindings: ReviewPrincipalBinding[],
  contextBindings: ReviewPrincipalBinding[],
  sdkFieldRootNames: Set<string>,
  sdkFieldLocalBindings: SdkFieldLocalBinding[],
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  const calls = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of calls) {
    const args = call.field("arguments");
    const safePrincipalRanges = collectSafeNullablePrincipalArgumentRanges(
      call,
      sdkFieldRootNames,
      sdkFieldLocalBindings,
      root,
    );
    const nullableArg = args
      ?.children()
      .find((child) =>
        nodeContainsArgumentPrincipalOptionalAccess(
          child,
          principalBindings,
          contextBindings,
          safePrincipalRanges,
          root,
        ),
      );
    if (!nullableArg) continue;

    const memberName = findMemberCallName(call);
    if (memberName && KYSELY_PREDICATE_METHODS.has(memberName)) {
      addReviewFinding(
        findings,
        seen,
        source,
        file,
        nullableArg,
        "Nullable caller value is used as a Kysely predicate value.",
      );
      continue;
    }

    addReviewFinding(
      findings,
      seen,
      source,
      file,
      nullableArg,
      `Nullable caller value is passed as a non-null argument to ${reviewCallName(call)}.`,
    );
  }
}

function functionIdentifierParamName(fn: SgNode): string | null {
  const param = getFirstFunctionParam(fn);
  const pattern = param ? getFunctionParamPattern(param) : null;
  return pattern?.kind() === "identifier" ? pattern.text() : null;
}

function objectPatternHasTopLevelProperty(pattern: SgNode, propertyName: string): boolean {
  if (pattern.kind() !== "object_pattern") return false;
  for (const child of pattern.children()) {
    const kind = child.kind();
    if (kind === "shorthand_property_identifier_pattern" && child.text() === propertyName) {
      return true;
    }
    if (kind === "pair_pattern" && child.field("key")?.text() === propertyName) {
      return true;
    }
    if (kind === "object_assignment_pattern") {
      const inner = child
        .children()
        .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
      if (inner?.text() === propertyName) return true;
    }
  }
  return false;
}

function functionReadsContextUser(fn: SgNode, contextName: string): boolean {
  const body = fn.field("body");
  if (!body) return false;
  const shadowRanges = collectCtxShadowRanges(body, contextName, fn);
  const userProperties = body.findAll({
    rule: { kind: "property_identifier", regex: "^user$" },
  });
  for (const propId of userProperties) {
    const parent = propId.parent();
    if (!parent || parent.kind() !== "member_expression") continue;
    const object = parent.field("object");
    if (!object || object.kind() !== "identifier" || object.text() !== contextName) continue;
    if (isInsideAnyRange(object.range().start.index, shadowRanges)) continue;
    return true;
  }

  const destructures = body.findAll({
    rule: {
      kind: "variable_declarator",
      has: {
        field: "value",
        kind: "identifier",
        regex: `^${escapeRegex(contextName)}$`,
      },
    },
  });
  for (const decl of destructures) {
    const value = decl.field("value");
    if (!value || isInsideAnyRange(value.range().start.index, shadowRanges)) continue;
    const name = decl.field("name");
    if (name && objectPatternHasTopLevelProperty(name, "user")) return true;
  }
  return false;
}

function functionContextUserSourceName(fn: SgNode): string | null {
  const param = getFirstFunctionParam(fn);
  const pattern = param ? getFunctionParamPattern(param) : null;
  if (!pattern) return null;
  if (pattern.kind() === "identifier") {
    return functionReadsContextUser(fn, pattern.text()) ? pattern.text() : null;
  }
  return objectPatternHasTopLevelProperty(pattern, "user") ? "context" : null;
}

type ContextUserHelperBinding = LocalCallbackBinding & { contextName: string };

function collectContextUserHelperBindings(root: SgNode): ContextUserHelperBinding[] {
  return collectLocalCallbackBindings(root).flatMap((binding) => {
    const contextName = functionContextUserSourceName(binding.fn);
    if (!contextName) return [];
    return [{ ...binding, contextName }];
  });
}

function resolveContextUserHelperBinding(
  node: SgNode,
  bindings: ContextUserHelperBinding[],
  root: SgNode,
): ContextUserHelperBinding | null {
  if (node.kind() !== "identifier") return null;
  const pos = node.range().start.index;
  return (
    bindings.find(
      (binding) =>
        binding.name === node.text() &&
        rangeContains(binding.scope, pos) &&
        !isShadowedLocalReference(root, binding.name, pos, binding.bindingStart),
    ) ?? null
  );
}

interface ResolverContextBody {
  arrow: SgNode;
  body: SgNode;
  contextName: string;
}

function addResolverContextBody(arrow: SgNode, bodies: ResolverContextBody[]): void {
  const paramName = functionIdentifierParamName(arrow);
  const body = arrow.field("body");
  if (!paramName || !body) return;
  bodies.push({ arrow, body, contextName: paramName });
}

function collectResolverBodyArrows(root: SgNode): SgNode[] {
  const sdkImports = root.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: "^[\"']@tailor-platform/sdk(/test)?[\"']$" },
    },
  });
  const createResolverLocalNames = new Set<string>();
  const sdkNamespaceNames = new Set<string>();
  for (const importStmt of sdkImports) {
    for (const namespaceName of iterateNamespaceImportLocalNames(importStmt)) {
      sdkNamespaceNames.add(namespaceName);
    }
    for (const { importedName, localName } of iterateImportSpecs(importStmt)) {
      if (importedName === "createResolver") createResolverLocalNames.add(localName);
    }
  }

  const arrows: SgNode[] = [];
  for (const localName of createResolverLocalNames) {
    const shadowRanges = collectAllShadowRanges(root, localName);
    const calls = root.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "identifier",
          regex: `^${escapeRegex(localName)}$`,
        },
      },
    });
    for (const call of calls) {
      const callee = call.field("function");
      if (!callee || isInsideAnyRange(callee.range().start.index, shadowRanges)) continue;
      const arrow = findResolverBodyArrow(call);
      if (arrow) arrows.push(arrow);
    }
  }

  for (const namespaceName of sdkNamespaceNames) {
    const shadowRanges = collectAllShadowRanges(root, namespaceName);
    const calls = root.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "member_expression",
          has: {
            field: "property",
            kind: "property_identifier",
            regex: "^createResolver$",
          },
        },
      },
    });
    for (const call of calls) {
      const callee = call.field("function");
      const object = callee?.field("object");
      if (!object || object.kind() !== "identifier" || object.text() !== namespaceName) continue;
      if (isInsideAnyRange(object.range().start.index, shadowRanges)) continue;
      const arrow = findResolverBodyArrow(call);
      if (arrow) arrows.push(arrow);
    }
  }
  return arrows;
}

function collectResolverContextBodies(root: SgNode): ResolverContextBody[] {
  const bodies: ResolverContextBody[] = [];
  for (const arrow of collectResolverBodyArrows(root)) {
    addResolverContextBody(arrow, bodies);
  }
  return bodies;
}

function collectResolverContextBindings(root: SgNode): ReviewPrincipalBinding[] {
  const bindings: ReviewPrincipalBinding[] = [];
  const rootRange = root.range();
  const rootScope: [number, number] = [rootRange.start.index, rootRange.end.index];

  for (const arrow of collectResolverBodyArrows(root)) {
    const param = getFirstFunctionParam(arrow);
    const pattern = param ? getFunctionParamPattern(param) : null;
    const body = arrow.field("body");
    if (!pattern || pattern.kind() !== "identifier" || !body) continue;

    const bodyRange = body.range();
    bindings.push({
      name: pattern.text(),
      bindingStart: pattern.range().start.index,
      scope: [bodyRange.start.index, bodyRange.end.index],
      shadowRoot: body,
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
    for (const decl of declarators) {
      const name = decl.field("name");
      const value = decl.field("value");
      if (!name || name.kind() !== "identifier" || !value) continue;

      const bindingStart = name.range().start.index;
      if (bindings.some((binding) => binding.bindingStart === bindingStart)) continue;
      if (!resolvesToReviewBinding(value, bindings, root)) continue;

      bindings.push({
        name: name.text(),
        bindingStart,
        scope: enclosingScopeRange(decl) ?? rootScope,
      });
      changed = true;
    }
  }

  return bindings;
}

function collectCallerPatternBindings(
  pattern: SgNode,
  scope: [number, number],
  bindings: ReviewPrincipalBinding[],
  shadowRoot?: SgNode,
): void {
  if (pattern.kind() !== "object_pattern") return;
  for (const child of pattern.children()) {
    const kind = child.kind();
    if (kind === "shorthand_property_identifier_pattern" && child.text() === "caller") {
      bindings.push({ name: "caller", bindingStart: child.range().start.index, scope, shadowRoot });
    } else if (kind === "pair_pattern") {
      const key = child.field("key");
      const value = child.field("value");
      if (key?.text() === "caller" && value?.kind() === "identifier") {
        bindings.push({
          name: value.text(),
          bindingStart: value.range().start.index,
          scope,
          shadowRoot,
        });
      }
    } else if (kind === "object_assignment_pattern") {
      const inner = child
        .children()
        .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
      if (inner?.text() === "caller") {
        bindings.push({
          name: "caller",
          bindingStart: inner.range().start.index,
          scope,
          shadowRoot,
        });
      }
    }
  }
}

function collectResolverPrincipalBindings(
  root: SgNode,
  contextBindings: ReviewPrincipalBinding[],
): ReviewPrincipalBinding[] {
  const bindings: ReviewPrincipalBinding[] = [];
  for (const arrow of collectResolverBodyArrows(root)) {
    const param = getFirstFunctionParam(arrow);
    const pattern = param ? getFunctionParamPattern(param) : null;
    const body = arrow.field("body");
    if (!pattern || !body) continue;
    const bodyRange = body.range();
    const bodyScope: [number, number] = [bodyRange.start.index, bodyRange.end.index];

    if (pattern.kind() === "object_pattern") {
      collectCallerPatternBindings(pattern, bodyScope, bindings, body);
      continue;
    }

    if (pattern.kind() !== "identifier") continue;

    const declarators = body.findAll({ rule: { kind: "variable_declarator" } });
    for (const decl of declarators) {
      const name = decl.field("name");
      const value = decl.field("value");
      if (!name || !value) continue;

      if (resolvesToReviewBinding(value, contextBindings, root)) {
        collectCallerPatternBindings(name, enclosingScopeRange(decl) ?? bodyScope, bindings);
        continue;
      }

      if (name.kind() !== "identifier") continue;
      const bindingStart = name.range().start.index;
      if (bindings.some((binding) => binding.bindingStart === bindingStart)) continue;
      if (
        !isReviewContextCallerMemberExpression(value, contextBindings, root) &&
        !resolvesToReviewPrincipalBinding(value, bindings, root)
      ) {
        continue;
      }

      bindings.push({
        name: name.text(),
        bindingStart,
        scope: enclosingScopeRange(decl) ?? bodyScope,
      });
    }
  }
  return bindings;
}

function firstIdentifierArgument(call: SgNode): SgNode | null {
  const args = call.field("arguments");
  if (!args) return null;
  for (const child of args.children()) {
    if (child.kind() === "(" || child.kind() === ")" || child.kind() === ",") continue;
    return child.kind() === "identifier" ? child : null;
  }
  return null;
}

function collectContextUserHelperReviewFindings(
  root: SgNode,
  source: string,
  file: string,
  findings: LlmReviewFinding[],
  seen: Set<string>,
): void {
  const helperBindings = collectContextUserHelperBindings(root);
  if (helperBindings.length === 0) return;

  const reportedDefinitions = new Set<number>();
  for (const { arrow, body, contextName } of collectResolverContextBodies(root)) {
    const shadowRanges = collectCtxShadowRanges(body, contextName, arrow);
    const calls = body.findAll({ rule: { kind: "call_expression" } });
    for (const call of calls) {
      if (isInsideAnyRange(call.range().start.index, shadowRanges)) continue;
      const arg = firstIdentifierArgument(call);
      if (!arg || arg.text() !== contextName) continue;
      const callee = call.field("function");
      if (!callee) continue;
      const helper = resolveContextUserHelperBinding(callee, helperBindings, root);
      if (!helper) continue;

      if (!reportedDefinitions.has(helper.bindingStart)) {
        reportedDefinitions.add(helper.bindingStart);
        addReviewFinding(
          findings,
          seen,
          source,
          file,
          helper.fn,
          `Helper adapter ${helper.name} reads ${helper.contextName}.user and needs v2 caller/invoker semantics.`,
        );
      }
      addReviewFinding(
        findings,
        seen,
        source,
        file,
        call,
        `${helper.name}(${contextName}) passes an SDK resolver context into a helper that reads ${helper.contextName}.user.`,
      );
    }
  }
}

export function reviewFindings(
  source: string,
  _filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  if (
    !source.includes("?.") &&
    !source.includes(".user") &&
    !source.includes("user") &&
    !source.includes("caller")
  ) {
    return [];
  }

  let root: SgNode;
  try {
    root = parse(Lang.TypeScript, source).root();
  } catch {
    return [];
  }

  const findings: LlmReviewFinding[] = [];
  const seen = new Set<string>();
  const contextBindings = collectResolverContextBindings(root);
  const principalBindings = collectResolverPrincipalBindings(root, contextBindings);
  const sdkFieldRootNames = collectSdkFieldRootNames(root);
  const sdkFieldLocalBindings = collectSdkFieldLocalBindings(root, sdkFieldRootNames);
  collectNullableCallerReviewFindings(
    root,
    source,
    relativePath,
    principalBindings,
    contextBindings,
    sdkFieldRootNames,
    sdkFieldLocalBindings,
    findings,
    seen,
  );
  collectContextUserHelperReviewFindings(root, source, relativePath, findings, seen);
  return findings;
}

/**
 * Migrate user/actor/invoker types and identifiers to the unified TailorPrincipal.
 *
 * - Renames `TailorUser` / `TailorActor` / `TailorInvoker` type references to `TailorPrincipal`.
 * - Rewrites SDK imports (including the `/test` subpath) to use `TailorPrincipal` (deduped
 *   across statements) and drops `unauthenticatedTailorUser`.
 * - Replaces standalone references to `unauthenticatedTailorUser` with `null`. Member-access
 *   forms like `unauthenticatedTailorUser.id` are left alone on purpose so the resulting TS
 *   error after the import is removed points the author at the broken access.
 * - Rewrites actor member accesses from `userId` / `userType` to `id` / `type`.
 * - Renames `user` to `caller` for top-level destructured resolver bodies (`{ input, user }`),
 *   handles aliased pairs (`{ user: currentUser }`) by rewriting only the property name, and
 *   rewrites `<ctx>.user` for non-destructured single-param bodies — respecting variable
 *   shadowing in both directions.
 * - Renames TailorDB hook/validator callback `user` parameters to `invoker`, and rewrites
 *   `.parse({ user: ... })` arguments to `.parse({ invoker: ... })`.
 * @param source - TypeScript source text.
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string): string | null {
  if (!quickFilter(source)) return null;

  const tree = parse(Lang.TypeScript, source).root();
  const edits: Edit[] = [];

  const sdkImports = tree.findAll({
    rule: {
      kind: "import_statement",
      has: { kind: "string", regex: "^[\"']@tailor-platform/sdk(/test)?[\"']$" },
    },
  });

  // Only rewrite type identifiers that are imported from the SDK without an
  // alias. A local `import type { TailorUser } from './domain'` must stay alone
  // even when the file also imports something else from the SDK.
  const sdkRenameSourceNames = new Set<string>();
  const tailorUserTypeLocalNames = new Set<string>();
  const nullableInvokerAliasLocalNames = new Set<string>();
  const actorTypeAliasLocalNames = new Set<string>();
  const actorTypeLocalNames = new Set<string>();
  const actorTypeValueLocalNames = new Set<string>();
  const sdkNamespaceNames = new Set<string>();
  for (const importStmt of sdkImports) {
    for (const namespaceName of iterateNamespaceImportLocalNames(importStmt)) {
      sdkNamespaceNames.add(namespaceName);
    }
    for (const { importedName, aliasNode, localName } of iterateImportSpecs(importStmt)) {
      if (TYPE_RENAME_MAP[importedName] && !aliasNode) {
        sdkRenameSourceNames.add(importedName);
      }
      if (importedName === "TailorUser") {
        tailorUserTypeLocalNames.add(localName);
      }
      if (importedName === "TailorActor") {
        actorTypeLocalNames.add(localName);
      }
      if (importedName === "TailorActorType") {
        actorTypeValueLocalNames.add(localName);
      }
      if (importedName === "TailorInvoker" && aliasNode) {
        nullableInvokerAliasLocalNames.add(localName);
      }
      if (importedName === "TailorActorType" && aliasNode) {
        actorTypeAliasLocalNames.add(localName);
      }
    }
  }

  const transformedActorPropertyStarts = new Set<number>();
  transformTailorActorTypedMemberAccesses(
    tree,
    actorTypeLocalNames,
    sdkNamespaceNames,
    edits,
    transformedActorPropertyStarts,
  );
  transformTailorActorTypeInitializerLiterals(
    tree,
    actorTypeValueLocalNames,
    sdkNamespaceNames,
    edits,
  );
  transformTailorActorTypeBindingComparisons(
    tree,
    actorTypeValueLocalNames,
    sdkNamespaceNames,
    edits,
  );

  let importRemoved = false;
  const globalEmittedRenamed = new Set<string>();
  // Populated only with names actually imported from the SDK (canonical or
  // alias). A file with a local `unauthenticatedTailorUser` declaration that
  // doesn't come from `@tailor-platform/sdk` is intentionally not rewritten.
  const unauthenticatedLocalNames = new Set<string>();
  for (const importStmt of sdkImports) {
    const { newText, touched } = rebuildImportStatement(
      importStmt,
      globalEmittedRenamed,
      unauthenticatedLocalNames,
      nullableInvokerAliasLocalNames,
      actorTypeAliasLocalNames,
    );
    if (!touched) continue;
    edits.push(importStmt.replace(newText));
    if (newText === "") importRemoved = true;
  }

  for (const localName of unauthenticatedLocalNames) {
    const shadowRanges = collectAllShadowRanges(tree, localName);
    const ids = tree.findAll({
      rule: {
        kind: "identifier",
        regex: `^${escapeRegex(localName)}$`,
      },
    });
    for (const id of ids) {
      if (isInsideImportStatement(id)) continue;
      if (isMemberExpressionObject(id)) continue;
      const pos = id.range().start.index;
      if (isInsideAnyRange(pos, shadowRanges)) continue;
      edits.push(id.replace("null"));
    }
  }

  // Resolve which local names refer to the SDK's `createResolver` so aliased
  // imports like `import { createResolver as makeResolver } ...` are migrated
  // and unrelated local helpers named `createResolver` (when the SDK import
  // does not actually bring `createResolver` in) are not.
  const createResolverLocalNames = new Set<string>();
  const createExecutorLocalNames = new Set<string>();
  const sdkFieldRootNames = collectSdkFieldRootNames(tree);
  for (const importStmt of sdkImports) {
    for (const { importedName, localName } of iterateImportSpecs(importStmt)) {
      if (importedName === "createResolver") {
        createResolverLocalNames.add(localName);
      }
      if (importedName === "createExecutor") {
        createExecutorLocalNames.add(localName);
      }
    }
  }
  const sdkFieldLocalBindings = collectSdkFieldLocalBindings(tree, sdkFieldRootNames);
  const parseContext: SdkFieldParseContext = {
    sdkFieldRootNames,
    sdkFieldLocalBindings,
    root: tree,
  };
  for (const localName of createResolverLocalNames) {
    const shadowRanges = collectAllShadowRanges(tree, localName);
    const calls = tree.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "identifier",
          regex: `^${escapeRegex(localName)}$`,
        },
      },
    });
    for (const call of calls) {
      const callee = call.field("function");
      if (!callee) continue;
      const pos = callee.range().start.index;
      if (isInsideAnyRange(pos, shadowRanges)) continue;
      const arrow = findResolverBodyArrow(call);
      if (arrow) transformResolverBody(arrow, edits, parseContext);
    }
  }
  for (const namespaceName of sdkNamespaceNames) {
    const shadowRanges = collectAllShadowRanges(tree, namespaceName);
    const calls = tree.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "member_expression",
          has: {
            field: "property",
            kind: "property_identifier",
            regex: "^createResolver$",
          },
        },
      },
    });
    for (const call of calls) {
      const callee = call.field("function");
      const object = callee?.field("object");
      if (!object || object.kind() !== "identifier" || object.text() !== namespaceName) continue;
      const pos = object.range().start.index;
      if (isInsideAnyRange(pos, shadowRanges)) continue;
      const arrow = findResolverBodyArrow(call);
      if (arrow) transformResolverBody(arrow, edits, parseContext);
    }
  }
  for (const localName of createExecutorLocalNames) {
    const shadowRanges = collectAllShadowRanges(tree, localName);
    const calls = tree.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "identifier",
          regex: `^${escapeRegex(localName)}$`,
        },
      },
    });
    for (const call of calls) {
      const callee = call.field("function");
      if (!callee) continue;
      const pos = callee.range().start.index;
      if (isInsideAnyRange(pos, shadowRanges)) continue;
      for (const fn of findExecutorBodyFunctions(call)) {
        transformExecutorBodyActorAccesses(fn, edits, transformedActorPropertyStarts);
      }
    }
  }
  for (const namespaceName of sdkNamespaceNames) {
    const shadowRanges = collectAllShadowRanges(tree, namespaceName);
    const calls = tree.findAll({
      rule: {
        kind: "call_expression",
        has: {
          field: "function",
          kind: "member_expression",
          has: {
            field: "property",
            kind: "property_identifier",
            regex: "^createExecutor$",
          },
        },
      },
    });
    for (const call of calls) {
      const callee = call.field("function");
      const object = callee?.field("object");
      if (!object || object.kind() !== "identifier" || object.text() !== namespaceName) continue;
      const pos = object.range().start.index;
      if (isInsideAnyRange(pos, shadowRanges)) continue;
      for (const fn of findExecutorBodyFunctions(call)) {
        transformExecutorBodyActorAccesses(fn, edits, transformedActorPropertyStarts);
      }
    }
  }
  transformActorTypeComparisonLiterals(tree, edits, transformedActorPropertyStarts);

  const callbackBindings = collectLocalCallbackBindings(tree);
  const objectBindings = collectLocalObjectBindings(tree);
  const typeContext: CallbackTypeContext = {
    bindings: collectLocalCallbackTypeBindings(tree),
    transformedTypeStarts: new Set<number>(),
    transformedPrincipalTypeStarts: new Set<number>(),
    tailorUserTypeLocalNames,
    sdkNamespaceNames,
    sdkFieldRootNames,
    sdkFieldLocalBindings,
    root: tree,
  };
  const transformedCallbackStarts = new Set<number>();
  const transformedObjectStarts = new Set<number>();
  const memberCalls = tree.findAll({ rule: { kind: "call_expression" } });
  for (const call of memberCalls) {
    transformPrincipalCallbacksInCall(
      call,
      edits,
      sdkFieldRootNames,
      sdkFieldLocalBindings,
      callbackBindings,
      objectBindings,
      transformedCallbackStarts,
      transformedObjectStarts,
      typeContext,
      tree,
    );
    transformParseArgsObject(call, edits, sdkFieldRootNames, sdkFieldLocalBindings, tree);
  }

  const typeIdents = tree.findAll({
    rule: {
      kind: "type_identifier",
      not: { inside: { kind: "import_statement" } },
    },
  });
  for (const id of typeIdents) {
    if (typeContext.transformedPrincipalTypeStarts.has(id.range().start.index)) continue;
    const qualifiedReplacement = namespaceQualifiedTypeReplacement(id, sdkNamespaceNames, tree);
    if (qualifiedReplacement) {
      edits.push(qualifiedReplacement.target.replace(qualifiedReplacement.text));
      continue;
    }
    const newName = sdkRenameSourceNames.has(id.text())
      ? renamedTypeIdentifierText(id.text())
      : nullableInvokerAliasLocalNames.has(id.text())
        ? renamedTypeIdentifierText("TailorInvoker")
        : actorTypeAliasLocalNames.has(id.text())
          ? renamedTypeIdentifierText("TailorActorType")
          : null;
    if (!newName) continue;
    edits.push(id.replace(newName));
  }

  if (edits.length === 0) return null;
  let result = tree.commitEdits(edits);

  if (importRemoved) {
    result = result.replace(/^[\t ]*\n+/, "").replace(/\n{3,}/g, "\n\n");
  }
  return result;
}
