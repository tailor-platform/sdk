import { parse, Lang } from "@ast-grep/napi";
import type { SgNode } from "@ast-grep/napi";

const GLOBALS_IMPORT = 'import "@tailor-platform/sdk/runtime/globals";';
const GLOBALS_IMPORT_PATH = "@tailor-platform/sdk/runtime/globals";
const GLOBALS_REFERENCE = '/// <reference types="@tailor-platform/sdk/runtime/globals" />';
const GLOBAL_NAMES = new Set([
  "tailor",
  "tailordb",
  "TailorDBFileError",
  "TailorErrorItem",
  "TailorErrorMessage",
  "TailorErrors",
]);
const TAILORDB_NAMESPACE_MEMBERS = new Set(["Client", "CommandType", "QueryResult"]);
const TAILOR_NAMESPACE_MEMBERS = new Map([
  ["context", new Set(["Invoker"])],
  ["iconv", new Set(["Iconv"])],
  [
    "idp",
    new Set([
      "Client",
      "ClientConfig",
      "CreateUserInput",
      "ListUsersOptions",
      "ListUsersResponse",
      "SendPasswordResetEmailInput",
      "UpdateUserInput",
      "User",
      "UserQuery",
    ]),
  ],
  ["workflow", new Set(["AuthInvoker", "TriggerWorkflowOptions"])],
]);
const GLOBAL_NAME_PATTERN = new RegExp(`\\b(?:${[...GLOBAL_NAMES].join("|")})\\b`);
const DECLARATION_PARENT_KINDS = new Set([
  "abstract_class_declaration",
  "class_declaration",
  "enum_declaration",
  "function_declaration",
  "generator_function_declaration",
  "interface_declaration",
  "internal_module",
  "type_alias_declaration",
]);
const VALUE_NAMESPACE_MEMBER_KINDS = new Set([
  "abstract_class_declaration",
  "class_declaration",
  "enum_declaration",
  "function_declaration",
  "generator_function_declaration",
  "lexical_declaration",
  "variable_declaration",
]);
const PARAMETER_PARENT_KINDS = new Set([
  "optional_parameter",
  "required_parameter",
  "rest_pattern",
]);
const PARAMETER_PREFIX_KINDS = new Set([
  "accessibility_modifier",
  "decorator",
  "override",
  "readonly",
]);
const FUNCTION_SCOPE_KINDS = new Set([
  "arrow_function",
  "function",
  "function_declaration",
  "function_expression",
  "function_type",
  "generator_function_declaration",
  "generator_function",
  "method_signature",
  "method_definition",
  "call_signature",
  "construct_signature",
]);
const MODULE_SCOPE_KINDS = new Set(["internal_module", "module"]);
const VAR_SCOPE_KINDS = new Set([
  ...FUNCTION_SCOPE_KINDS,
  "class_static_block",
  ...MODULE_SCOPE_KINDS,
]);
const TYPE_PARAMETER_SCOPE_KINDS = new Set([
  ...FUNCTION_SCOPE_KINDS,
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
]);
const ACCESS_EXPRESSION_KINDS = new Set(["member_expression", "subscript_expression"]);
const BARE_GLOBAL_REFERENCE_KINDS = new Set([
  "identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
  "type_identifier",
]);
const BLOCK_SCOPE_KINDS = new Set(["program", "statement_block", "switch_body"]);
const CATCH_SCOPE_KINDS = new Set(["catch_clause"]);
const FOR_SCOPE_KINDS = new Set(["for_in_statement", "for_statement"]);
const IMPORT_STATEMENT_KINDS = new Set(["import_statement"]);
const WRAPPER_EXPRESSION_KINDS = new Set([
  "as_expression",
  "non_null_expression",
  "parenthesized_expression",
  "satisfies_expression",
  "type_assertion",
]);
const EXPRESSION_NAME_PARENT_KINDS = new Set([
  "class",
  "function_expression",
  "generator_function",
]);
const NON_INITIALIZER_AFTER_BINDING_KINDS = new Set(["comment", "type_annotation"]);
const LINE_SCOPED_PRAGMA_PATTERN =
  /^(?:\/\/|\/\*)\s*(?:eslint-disable-next-line\b|oxlint-disable-next-line\b|@ts-(?:expect-error|ignore)\b|prettier-ignore\b|biome-ignore\b|rome-ignore\b|deno-lint-ignore\b|(?:c8|v8|istanbul|node:coverage|coverage)\s+ignore\s+next\b)/;

type ReferenceNamespace = "namespace" | "type" | "value";
type BindingNamespace = ReferenceNamespace | "all" | "both" | "type-namespace";

interface ScopedBinding {
  name: string;
  namespace: BindingNamespace;
  node: SgNode;
  scope: SgNode;
}

function parseSource(source: string, filePath: string) {
  return parse(
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? Lang.Tsx : Lang.TypeScript,
    source,
  );
}

function firstNamedChild(node: SgNode): SgNode | undefined {
  return node.children().find((child) => child.isNamed());
}

function isSameNode(a: SgNode | undefined, b: SgNode): boolean {
  return a?.id() === b.id();
}

function hasChildKind(node: SgNode | null | undefined, kind: string): boolean {
  return node?.children().some((child) => child.kind() === kind) === true;
}

function importSpecifierLocalName(node: SgNode): string | null {
  const identifiers = node.findAll({ rule: { kind: "identifier" } });
  return identifiers.at(-1)?.text() ?? null;
}

function importSpecifierLocalNode(node: SgNode): SgNode | null {
  const identifiers = node.findAll({ rule: { kind: "identifier" } });
  return identifiers.at(-1) ?? null;
}

function importAliasLocalNode(node: SgNode): SgNode | null {
  const local = firstNamedChild(node);
  return local?.kind() === "identifier" ? local : null;
}

function declaratorAncestor(node: SgNode): SgNode | null {
  let current = node.parent();
  while (current) {
    if (current.kind() === "variable_declarator") return current;
    current = current.parent();
  }
  return null;
}

function bindingPatternName(node: SgNode, bindingPattern: SgNode, stop: SgNode): boolean {
  let current: SgNode | null = node;
  while (current) {
    if (current.kind() === "assignment_pattern" || current.kind() === "object_assignment_pattern") {
      const bindingTarget = firstNamedChild(current);
      return bindingTarget != null && containsNode(bindingTarget, node);
    }
    if (current.kind() === "pair_pattern") {
      const key = firstNamedChild(current);
      return key != null && !containsNode(key, node);
    }
    if (isSameNode(current, bindingPattern)) return true;
    if (isSameNode(current, stop)) return false;
    current = current.parent();
  }
  return false;
}

function isInVariableBindingPattern(node: SgNode): boolean {
  const declarator = declaratorAncestor(node);
  if (!declarator) return false;
  const bindingPattern = firstNamedChild(declarator);
  if (!bindingPattern) return false;

  let current: SgNode | null = node;
  while (current) {
    if (isSameNode(current, bindingPattern)) return true;
    if (isSameNode(current, declarator)) return false;
    current = current.parent();
  }
  return false;
}

function isVariableBindingName(node: SgNode): boolean {
  const declarator = declaratorAncestor(node);
  if (!declarator || !isInVariableBindingPattern(node)) return false;
  const bindingPattern = firstNamedChild(declarator);
  return bindingPattern != null && bindingPatternName(node, bindingPattern, declarator);
}

function parameterAncestor(node: SgNode): SgNode | null {
  return nearestAncestorKind(node, PARAMETER_PARENT_KINDS);
}

function parameterBindingPattern(parameter: SgNode): SgNode | undefined {
  return parameter
    .children()
    .find((child) => child.isNamed() && !PARAMETER_PREFIX_KINDS.has(child.kind()));
}

function isParameterBindingName(node: SgNode): boolean {
  const parameter = parameterAncestor(node);
  const bindingPattern = parameter ? parameterBindingPattern(parameter) : undefined;
  return bindingPattern != null && bindingPatternName(node, bindingPattern, parameter);
}

function isForBindingName(node: SgNode): boolean {
  const parent = nearestAncestorKind(node, new Set(["for_in_statement"]));
  if (parent == null || !/^for(?:\s+await)?\s*\(\s*(const|let|var)\s/.test(parent.text())) {
    return false;
  }
  const bindingPattern = firstNamedChild(parent);
  return bindingPattern != null && bindingPatternName(node, bindingPattern, parent);
}

function isForVarBindingName(node: SgNode): boolean {
  const parent = nearestAncestorKind(node, new Set(["for_in_statement"]));
  return (
    parent != null && /^for(?:\s+await)?\s*\(\s*var\s/.test(parent.text()) && isForBindingName(node)
  );
}

function isForStatementInitializerBinding(node: SgNode): boolean {
  const declarator = declaratorAncestor(node);
  const forStatement = nearestAncestorKind(node, FOR_SCOPE_KINDS);
  const initializer =
    forStatement?.kind() === "for_statement" ? firstNamedChild(forStatement) : undefined;
  return declarator != null && initializer != null && containsNode(initializer, declarator);
}

function isVarBindingName(node: SgNode): boolean {
  const declaration = declaratorAncestor(node)?.parent();
  return declaration?.kind() === "variable_declaration" && /^var\b/.test(declaration.text());
}

function usingDeclarationAncestor(node: SgNode): SgNode | null {
  const parent = node.parent();
  if (parent?.kind() !== "assignment_expression") return null;
  if (!parent.children().some((child) => child.kind() === "using")) return null;
  return isSameNode(firstNamedChild(parent), node) ? parent : null;
}

function isUsingBindingName(node: SgNode): boolean {
  return usingDeclarationAncestor(node) != null;
}

function isCatchBindingName(node: SgNode): boolean {
  const catchClause = nearestAncestorKind(node, CATCH_SCOPE_KINDS);
  if (catchClause == null || !/\bcatch\s*\(/.test(catchClause.text())) return false;
  const bindingPattern = catchClause ? firstNamedChild(catchClause) : undefined;
  return bindingPattern != null && bindingPatternName(node, bindingPattern, catchClause);
}

function isInferTypeBindingName(node: SgNode): boolean {
  const parent = node.parent();
  return parent?.kind() === "infer_type" && isSameNode(firstNamedChild(parent), node);
}

function isExportAsNamespaceName(node: SgNode): boolean {
  const parent = node.parent();
  return (
    parent?.kind() === "export_statement" &&
    /^export\s+as\s+namespace\b/.test(parent.text()) &&
    isSameNode(firstNamedChild(parent), node)
  );
}

function isBindingIdentifier(node: SgNode): boolean {
  const parent = node.parent();
  if (!parent) return false;

  if (isVariableBindingName(node)) return true;
  if (isParameterBindingName(node)) return true;
  if (isForBindingName(node)) return true;
  if (isCatchBindingName(node)) return true;
  if (isQualifiedNamespaceBindingName(node)) return true;
  if (isUsingBindingName(node)) return true;
  if (isInferTypeBindingName(node)) return true;
  if (isExportAsNamespaceName(node)) return true;

  const parentKind = parent.kind();
  if (parentKind === "import_alias")
    return isSameNode(importAliasLocalNode(parent) ?? undefined, node);
  if (parentKind === "import_specifier") return importSpecifierLocalName(parent) === node.text();
  if (
    parentKind === "import_clause" ||
    parentKind === "import_require_clause" ||
    parentKind === "namespace_import"
  ) {
    return true;
  }
  if (DECLARATION_PARENT_KINDS.has(parentKind)) return isSameNode(firstNamedChild(parent), node);
  if (EXPRESSION_NAME_PARENT_KINDS.has(parentKind))
    return isSameNode(firstNamedChild(parent), node);
  if (parentKind === "type_parameter" || parentKind === "mapped_type_clause") {
    return isSameNode(firstNamedChild(parent), node);
  }
  if (parentKind === "index_signature") return isSameNode(firstNamedChild(parent), node);

  return false;
}

function nameNodes(root: SgNode, names: Set<string>): SgNode[] {
  const nodes: SgNode[] = [];
  const visit = (node: SgNode): void => {
    if (node.isNamedLeaf() && names.has(node.text())) nodes.push(node);
    for (const child of node.children()) visit(child);
  };
  visit(root);
  return nodes;
}

function globalNameNodes(root: SgNode): SgNode[] {
  return nameNodes(root, GLOBAL_NAMES);
}

function nearestAncestorKind(node: SgNode, kinds: Set<string>): SgNode | null {
  let current = node.parent();
  while (current) {
    if (kinds.has(current.kind())) return current;
    current = current.parent();
  }
  return null;
}

function statementBlockScope(container: SgNode): SgNode {
  return container.children().find((child) => child.kind() === "statement_block") ?? container;
}

function varBindingScope(node: SgNode, root: SgNode): SgNode {
  const container = nearestAncestorKind(node, VAR_SCOPE_KINDS);
  if (container == null) return root;
  return FUNCTION_SCOPE_KINDS.has(container.kind()) ? statementBlockScope(container) : container;
}

function importBindingScope(node: SgNode, root: SgNode): SgNode {
  return nearestAncestorKind(node, MODULE_SCOPE_KINDS) ?? root;
}

function declareGlobalBlock(node: SgNode): SgNode | null {
  let current = node.parent();
  while (current) {
    if (current.kind() === "ambient_declaration" && hasChildKind(current, "global")) {
      return current.children().find((child) => child.kind() === "statement_block") ?? null;
    }
    current = current.parent();
  }
  return null;
}

function hasDeclareGlobalBlock(root: SgNode): boolean {
  let found = false;
  const visit = (node: SgNode): void => {
    if (found) return;
    if (node.kind() === "ambient_declaration" && hasChildKind(node, "global")) {
      found = true;
      return;
    }
    for (const child of node.children()) visit(child);
  };
  visit(root);
  return found;
}

function isDirectDeclareGlobalBinding(node: SgNode): boolean {
  const block = declareGlobalBlock(node);
  if (!block) return false;

  let current = node.parent();
  while (current) {
    if (isSameNode(current, block)) return true;
    if (current.kind() === "statement_block") return false;
    current = current.parent();
  }
  return false;
}

function bindingScope(node: SgNode, root: SgNode): SgNode {
  const parentKind = node.parent()?.kind();
  if (isVariableBindingName(node) && isVarBindingName(node)) {
    return varBindingScope(node, root);
  }
  if (isForVarBindingName(node)) {
    return varBindingScope(node, root);
  }
  if (isUsingBindingName(node)) return nearestAncestorKind(node, BLOCK_SCOPE_KINDS) ?? root;
  if (isForStatementInitializerBinding(node)) {
    return nearestAncestorKind(node, FOR_SCOPE_KINDS) ?? root;
  }
  if (
    parentKind === "import_clause" ||
    parentKind === "import_alias" ||
    parentKind === "import_require_clause" ||
    parentKind === "import_specifier" ||
    parentKind === "namespace_import"
  ) {
    return importBindingScope(node, root);
  }
  if (parentKind != null && EXPRESSION_NAME_PARENT_KINDS.has(parentKind)) {
    return node.parent() ?? root;
  }
  if (parentKind === "type_parameter") {
    return nearestAncestorKind(node, TYPE_PARAMETER_SCOPE_KINDS) ?? root;
  }
  if (parentKind === "infer_type") {
    return nearestAncestorKind(node, new Set(["conditional_type"])) ?? node.parent() ?? root;
  }
  if (parentKind === "mapped_type_clause") {
    return nearestAncestorKind(node, new Set(["index_signature"])) ?? root;
  }
  if (parentKind === "index_signature") return node.parent() ?? root;
  if (isExportAsNamespaceName(node)) return root;
  if (parentKind != null && PARAMETER_PARENT_KINDS.has(parentKind)) {
    return nearestAncestorKind(node, FUNCTION_SCOPE_KINDS) ?? root;
  }
  const parameter = parameterAncestor(node);
  if (parameter) return nearestAncestorKind(parameter, FUNCTION_SCOPE_KINDS) ?? root;

  if (isForBindingName(node)) return nearestAncestorKind(node, FOR_SCOPE_KINDS) ?? root;
  if (isCatchBindingName(node)) return nearestAncestorKind(node, CATCH_SCOPE_KINDS) ?? root;
  if (isDirectDeclareGlobalBinding(node)) return root;

  return nearestAncestorKind(node, BLOCK_SCOPE_KINDS) ?? root;
}

function isTypeOnlyImport(node: SgNode): boolean {
  const parent = node.parent();
  const importStatement = nearestAncestorKind(node, IMPORT_STATEMENT_KINDS);
  return hasChildKind(parent, "type") || hasChildKind(importStatement, "type");
}

function hasRuntimeNamespaceMember(node: SgNode): boolean {
  const runtimeKinds = new Set([
    "abstract_class_declaration",
    "class_declaration",
    "enum_declaration",
    "export_assignment",
    "function_declaration",
    "generator_function_declaration",
    "lexical_declaration",
    "variable_declaration",
  ]);
  const visit = (current: SgNode): boolean => {
    if (runtimeKinds.has(current.kind())) return true;
    if (current.kind() === "internal_module") return hasRuntimeNamespaceMember(current);
    if (
      current.kind() === "expression_statement" &&
      current.children().some((child) => child.isNamed())
    ) {
      const namedChildren = current.children().filter((child) => child.isNamed());
      return namedChildren.every((child) => child.kind() === "internal_module")
        ? namedChildren.some(visit)
        : true;
    }
    return current.children().some(visit);
  };
  return (
    node
      .children()
      .find((child) => child.kind() === "statement_block")
      ?.children()
      .some(visit) === true
  );
}

function namespaceBindingModule(node: SgNode): SgNode | null {
  const parent = node.parent();
  if (parent?.kind() === "internal_module") return parent;
  if (parent?.kind() !== "nested_identifier") return null;
  const namespace = parent.parent();
  if (namespace?.kind() !== "internal_module") return null;
  return isSameNode(firstNamedChild(parent), node) ? namespace : null;
}

function isQualifiedNamespaceBindingName(node: SgNode): boolean {
  return node.parent()?.kind() === "nested_identifier" && namespaceBindingModule(node) != null;
}

function isTypeOnlyNamespace(node: SgNode): boolean {
  const namespace = namespaceBindingModule(node);
  if (!namespace) return false;
  if (namespace.parent()?.kind() === "ambient_declaration") return true;
  return !hasRuntimeNamespaceMember(namespace);
}

function initializerAfterBinding(node: SgNode, binding: SgNode): SgNode | null {
  return (
    node
      .children()
      .find(
        (child) =>
          child.isNamed() &&
          child.range().start.index > binding.range().end.index &&
          !NON_INITIALIZER_AFTER_BINDING_KINDS.has(child.kind()),
      ) ?? null
  );
}

function isUnshadowedGlobalThisExpression(
  node: SgNode | undefined,
  globalThisBindings: ScopedBinding[],
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  return (
    (isGlobalThisExpression(node) && !isShadowedGlobalThisExpression(node, globalThisBindings)) ||
    isGlobalThisAliasExpression(node, globalThisAliases, aliasValueBindings)
  );
}

function globalThisDestructuringBinding(
  node: SgNode,
  globalThisBindings: ScopedBinding[],
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): SgNode | null {
  const declarator = declaratorAncestor(node);
  const binding = declarator ? firstNamedChild(declarator) : undefined;
  if (
    declarator &&
    binding &&
    containsNode(binding, node) &&
    isUnshadowedGlobalThisExpression(
      initializerAfterBinding(declarator, binding) ?? undefined,
      globalThisBindings,
      globalThisAliases,
      aliasValueBindings,
    )
  ) {
    return binding;
  }

  const parameter = parameterAncestor(node);
  const parameterBinding = parameter ? parameterBindingPattern(parameter) : undefined;
  if (
    parameter &&
    parameterBinding &&
    containsNode(parameterBinding, node) &&
    isUnshadowedGlobalThisExpression(
      initializerAfterBinding(parameter, parameterBinding) ?? undefined,
      globalThisBindings,
      globalThisAliases,
      aliasValueBindings,
    )
  ) {
    return parameterBinding;
  }

  const assignment = nearestAncestorKind(node, new Set(["assignment_expression"]));
  const assignmentBinding = assignment ? firstNamedChild(assignment) : undefined;
  if (
    assignment &&
    assignmentBinding &&
    containsNode(assignmentBinding, node) &&
    isUnshadowedGlobalThisExpression(
      initializerAfterBinding(assignment, assignmentBinding) ?? undefined,
      globalThisBindings,
      globalThisAliases,
      aliasValueBindings,
    )
  ) {
    return assignmentBinding;
  }

  return null;
}

function isGlobalThisDestructuredProperty(
  node: SgNode,
  globalThisBindings: ScopedBinding[],
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  const binding = globalThisDestructuringBinding(
    node,
    globalThisBindings,
    globalThisAliases,
    aliasValueBindings,
  );
  if (!binding) return false;
  if (node.kind() === "shorthand_property_identifier_pattern") {
    const parent = node.parent();
    return (
      isSameNode(parent, binding) ||
      ((parent?.kind() === "assignment_pattern" ||
        parent?.kind() === "object_assignment_pattern") &&
        isSameNode(parent.parent(), binding))
    );
  }

  let current = node.parent();
  while (current && !isSameNode(current, binding)) {
    if (current.kind() === "object_assignment_pattern") {
      const target = firstNamedChild(current);
      return isSameNode(current.parent(), binding) && target != null && containsNode(target, node);
    }
    if (current.kind() === "pair_pattern") {
      const key = firstNamedChild(current);
      return (
        isSameNode(current.parent(), binding) &&
        key != null &&
        destructuredPropertyName(key) === node.text() &&
        containsNode(key, node)
      );
    }
    current = current.parent();
  }
  return false;
}

function destructuredPropertyName(key: SgNode): string | null {
  if (key.kind() === "computed_property_name") {
    const expression = firstNamedChild(key);
    return expression ? staticLiteralPropertyName(expression) : null;
  }
  return staticPropertyName(key);
}

function staticPropertyName(node: SgNode): string | null {
  let current: SgNode | null = node;
  while (current && WRAPPER_EXPRESSION_KINDS.has(current.kind())) {
    current = firstNamedChild(current) ?? null;
  }
  if (!current) return null;

  const kind = current.kind();
  if (
    kind === "identifier" ||
    kind === "property_identifier" ||
    kind === "shorthand_property_identifier" ||
    kind === "shorthand_property_identifier_pattern"
  ) {
    return current.text();
  }

  const text = current.text();
  for (const name of GLOBAL_NAMES) {
    if (text === `"${name}"` || text === `'${name}'` || text === `\`${name}\``) {
      return name;
    }
  }
  return null;
}

function staticLiteralPropertyName(node: SgNode): string | null {
  let current: SgNode | null = node;
  while (current && WRAPPER_EXPRESSION_KINDS.has(current.kind())) {
    current = firstNamedChild(current) ?? null;
  }
  if (!current) return null;

  const text = current.text();
  for (const name of GLOBAL_NAMES) {
    if (text === `"${name}"` || text === `'${name}'` || text === `\`${name}\``) {
      return name;
    }
  }
  return null;
}

function bindingNamespace(node: SgNode): BindingNamespace {
  const parentKind = node.parent()?.kind();
  if (isQualifiedNamespaceBindingName(node)) {
    return isTypeOnlyNamespace(node) ? "type-namespace" : "namespace";
  }
  if (
    parentKind === "import_clause" ||
    parentKind === "import_alias" ||
    parentKind === "import_require_clause" ||
    parentKind === "import_specifier" ||
    parentKind === "namespace_import"
  ) {
    if (parentKind === "import_alias") return "all";
    if (parentKind === "import_require_clause" || parentKind === "namespace_import") {
      return isTypeOnlyImport(node) ? "type-namespace" : "namespace";
    }
    return isTypeOnlyImport(node) ? "type" : "both";
  }
  if (parentKind === "type_alias_declaration" || parentKind === "interface_declaration") {
    return "type";
  }
  if (parentKind === "internal_module") {
    return isTypeOnlyNamespace(node) ? "type-namespace" : "namespace";
  }
  if (parentKind === "class") return "both";
  if (parentKind === "abstract_class_declaration" || parentKind === "class_declaration") {
    return "both";
  }
  if (parentKind === "enum_declaration") return "all";
  if (
    parentKind === "type_parameter" ||
    parentKind === "infer_type" ||
    parentKind === "mapped_type_clause" ||
    parentKind === "index_signature"
  ) {
    return "type";
  }
  if (isExportAsNamespaceName(node)) return "namespace";
  return "value";
}

function localNameBindings(root: SgNode, names: Set<string>): ScopedBinding[] {
  return nameNodes(root, names)
    .filter(isBindingIdentifier)
    .map((node) => ({
      name: node.text(),
      namespace: bindingNamespace(node),
      node,
      scope: bindingScope(node, root),
    }));
}

function localGlobalBindings(root: SgNode): ScopedBinding[] {
  return localNameBindings(root, GLOBAL_NAMES);
}

function localValueBindings(root: SgNode, name: string): ScopedBinding[] {
  return localValueBindingsForNames(root, new Set([name]));
}

function localValueBindingsForNames(root: SgNode, names: Set<string>): ScopedBinding[] {
  return localNameBindings(root, names).filter((binding) =>
    bindingShadowsReference(binding.namespace, "value"),
  );
}

function isConstVariableDeclarator(node: SgNode): boolean {
  const declaration = node.parent();
  return declaration?.kind() === "lexical_declaration" && /\bconst\b/.test(declaration.text());
}

function globalThisAliasBindings(
  root: SgNode,
  globalThisBindings: ScopedBinding[],
): ScopedBinding[] {
  const aliases: ScopedBinding[] = [];
  const visit = (node: SgNode): void => {
    if (node.kind() === "variable_declarator" && isConstVariableDeclarator(node)) {
      const binding = firstNamedChild(node);
      const aliasValueBindings =
        aliases.length === 0
          ? []
          : localValueBindingsForNames(root, new Set(aliases.map((alias) => alias.name)));
      if (
        binding?.kind() === "identifier" &&
        isUnshadowedGlobalThisExpression(
          initializerAfterBinding(node, binding) ?? undefined,
          globalThisBindings,
          aliases,
          aliasValueBindings,
        )
      ) {
        aliases.push({
          name: binding.text(),
          namespace: "value",
          node: binding,
          scope: bindingScope(binding, root),
        });
      }
    }

    for (const child of node.children()) visit(child);
  };
  visit(root);
  return aliases;
}

function containsNode(ancestor: SgNode, node: SgNode): boolean {
  let current: SgNode | null = node;
  while (current) {
    if (isSameNode(current, ancestor)) return true;
    current = current.parent();
  }
  return false;
}

function isReExportSpecifier(node: SgNode): boolean {
  const exportStatement = nearestAncestorKind(node, new Set(["export_statement"]));
  return exportStatement?.children().some((child) => child.kind() === "from") === true;
}

function isTypeOnlyExportSpecifier(node: SgNode): boolean {
  const parent = node.parent();
  if (parent?.kind() !== "export_specifier") return false;
  const exportStatement = nearestAncestorKind(node, new Set(["export_statement"]));
  return hasChildKind(parent, "type") || hasChildKind(exportStatement, "type");
}

function isSpecifierNonReferenceName(node: SgNode): boolean {
  const parent = node.parent();
  if (parent?.kind() === "namespace_export") return true;
  if (parent?.kind() === "import_specifier") {
    return !isSameNode(importSpecifierLocalNode(parent) ?? undefined, node);
  }
  if (parent?.kind() !== "export_specifier") return false;

  if (isReExportSpecifier(node)) return true;

  const identifiers = parent.findAll({ rule: { kind: "identifier" } });
  return identifiers.length > 1 && isSameNode(identifiers.at(-1), node);
}

function isJsxTagName(node: SgNode): boolean {
  const parent = node.parent();
  return (
    parent != null &&
    (parent.kind() === "jsx_closing_element" ||
      parent.kind() === "jsx_opening_element" ||
      parent.kind() === "jsx_self_closing_element") &&
    isSameNode(firstNamedChild(parent), node)
  );
}

function globalThisSubscriptFromStringFragment(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): SgNode | null {
  if (node.kind() !== "string_fragment") return null;
  let expression = node.parent();
  if (expression?.kind() !== "string" && expression?.kind() !== "template_string") return null;
  if (expression.kind() === "template_string" && expression.text() !== `\`${node.text()}\``) {
    return null;
  }
  while (expression.parent() && WRAPPER_EXPRESSION_KINDS.has(expression.parent()?.kind() ?? "")) {
    expression = expression.parent();
  }
  const subscript = expression.parent();
  if (subscript?.kind() !== "subscript_expression") return null;
  return isGlobalThisLikeExpression(
    firstNamedChild(subscript),
    globalThisAliases,
    aliasValueBindings,
  )
    ? subscript
    : null;
}

function unwrapParenthesizedType(node: SgNode | undefined): SgNode | undefined {
  let current = node;
  while (current?.kind() === "parenthesized_type") {
    current = firstNamedChild(current);
  }
  return current;
}

function typeQueryExpression(node: SgNode | undefined): SgNode | undefined {
  const query = unwrapParenthesizedType(node);
  return query?.kind() === "type_query" ? firstNamedChild(query) : undefined;
}

function globalThisLookupTypeFromStringFragment(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): SgNode | null {
  if (node.kind() !== "string_fragment") return null;
  const stringLiteral = node.parent();
  if (stringLiteral?.kind() !== "string") return null;
  const literalType = stringLiteral.parent();
  if (literalType?.kind() !== "literal_type") return null;
  const lookupType = literalType.parent();
  if (lookupType?.kind() !== "lookup_type") return null;

  const targetType = firstNamedChild(lookupType);
  if (targetType == null || isSameNode(targetType, literalType)) return null;
  const expression = typeQueryExpression(targetType);
  return expression != null &&
    isGlobalThisLikeExpression(expression, globalThisAliases, aliasValueBindings)
    ? lookupType
    : null;
}

function identifierExpression(node: SgNode | undefined): SgNode | null {
  if (node == null) return null;
  if (node.kind() === "identifier") return node;
  if (WRAPPER_EXPRESSION_KINDS.has(node.kind())) {
    return identifierExpression(firstNamedChild(node));
  }
  return null;
}

function globalThisIdentifier(node: SgNode | undefined): SgNode | null {
  const identifier = identifierExpression(node);
  return identifier?.text() === "globalThis" ? identifier : null;
}

function isGlobalThisExpression(node: SgNode | undefined): boolean {
  return globalThisIdentifier(node) != null;
}

function isReferenceToScopedBinding(
  identifier: SgNode,
  binding: ScopedBinding,
  bindings: ScopedBinding[],
): boolean {
  if (identifier.text() !== binding.name || !containsNode(binding.scope, identifier)) return false;
  return !bindings.some(
    (candidate) =>
      candidate.name === binding.name &&
      !isSameNode(candidate.node, binding.node) &&
      containsNode(candidate.scope, identifier) &&
      containsNode(binding.scope, candidate.node),
  );
}

function isGlobalThisAliasExpression(
  node: SgNode | undefined,
  globalThisAliases: ScopedBinding[],
  aliasValueBindings: ScopedBinding[],
): boolean {
  const identifier = identifierExpression(node);
  return (
    identifier != null &&
    globalThisAliases.some((alias) =>
      isReferenceToScopedBinding(identifier, alias, aliasValueBindings),
    )
  );
}

function isGlobalThisLikeExpression(
  node: SgNode | undefined,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  return (
    isGlobalThisExpression(node) ||
    isGlobalThisAliasExpression(node, globalThisAliases, aliasValueBindings)
  );
}

function isShadowedGlobalThisExpression(
  node: SgNode | undefined,
  globalThisBindings: ScopedBinding[],
): boolean {
  const identifier = globalThisIdentifier(node);
  return (
    identifier != null &&
    globalThisBindings.some((binding) => containsNode(binding.scope, identifier))
  );
}

function globalReferenceAncestor(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): SgNode | null {
  if (!GLOBAL_NAMES.has(node.text())) return null;
  if (isJsxTagName(node)) return null;
  if (isSpecifierNonReferenceName(node)) return null;
  const globalThisSubscript = globalThisSubscriptFromStringFragment(
    node,
    globalThisAliases,
    aliasValueBindings,
  );
  if (globalThisSubscript) return globalThisSubscript;
  const globalThisLookupType = globalThisLookupTypeFromStringFragment(
    node,
    globalThisAliases,
    aliasValueBindings,
  );
  if (globalThisLookupType) return globalThisLookupType;

  let current = node.parent();
  while (current) {
    const kind = current.kind();
    if (kind === "nested_identifier" || kind === "nested_type_identifier") {
      const path = qualifiedPath(current);
      if (path?.[0] !== node.text()) return null;
      let reference = current;
      while (
        reference.parent() &&
        (reference.parent()?.kind() === "nested_identifier" ||
          reference.parent()?.kind() === "nested_type_identifier") &&
        qualifiedPath(reference.parent()!)?.[0] === node.text()
      ) {
        reference = reference.parent()!;
      }
      return reference;
    }
    if (ACCESS_EXPRESSION_KINDS.has(kind)) {
      const object = firstNamedChild(current);
      if (isGlobalThisLikeExpression(object, globalThisAliases, aliasValueBindings)) return current;
      if (object == null || !containsNode(object, node)) return null;
      let reference = current;
      while (
        reference.parent() &&
        ACCESS_EXPRESSION_KINDS.has(reference.parent()?.kind() ?? "") &&
        containsNode(firstNamedChild(reference.parent()!) ?? reference.parent()!, node)
      ) {
        reference = reference.parent()!;
      }
      return reference;
    }
    if (WRAPPER_EXPRESSION_KINDS.has(kind)) {
      current = current.parent();
      continue;
    }
    return BARE_GLOBAL_REFERENCE_KINDS.has(node.kind()) && !isBindingIdentifier(node) ? node : null;
  }
  return BARE_GLOBAL_REFERENCE_KINDS.has(node.kind()) && !isBindingIdentifier(node) ? node : null;
}

function globalThisReferenceObject(reference: SgNode): SgNode | undefined {
  if (ACCESS_EXPRESSION_KINDS.has(reference.kind())) return firstNamedChild(reference);
  if (reference.kind() === "lookup_type") return typeQueryExpression(firstNamedChild(reference));
  return undefined;
}

function isGlobalReference(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  return globalReferenceAncestor(node, globalThisAliases, aliasValueBindings) != null;
}

function referenceNamespace(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): ReferenceNamespace {
  const reference = globalReferenceAncestor(node, globalThisAliases, aliasValueBindings);
  const referenceKind = reference?.kind();
  if (referenceKind === "nested_identifier" || referenceKind === "nested_type_identifier") {
    return "namespace";
  }
  if (isTypeOnlyExportSpecifier(node)) return "type";
  return referenceKind === "type_identifier" ? "type" : "value";
}

function runtimeNamespaceMemberPath(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): string[] | null {
  const reference = globalReferenceAncestor(node, globalThisAliases, aliasValueBindings);
  const referenceKind = reference?.kind();
  if (
    referenceKind !== "nested_identifier" &&
    referenceKind !== "nested_type_identifier" &&
    referenceKind !== "member_expression"
  ) {
    return null;
  }

  const parts = qualifiedPath(reference);
  if (!parts) return null;
  if (parts[0] !== node.text()) return null;

  if (parts[0] === "tailordb" && TAILORDB_NAMESPACE_MEMBERS.has(parts[1] ?? "")) {
    return parts.slice(0, 2);
  }

  const tailorMembers = parts[0] === "tailor" ? TAILOR_NAMESPACE_MEMBERS.get(parts[1] ?? "") : null;
  if (tailorMembers?.has(parts[2] ?? "") === true) {
    return parts.slice(0, 3);
  }

  return null;
}

function qualifiedPath(node: SgNode): string[] | null {
  if (
    node.kind() === "identifier" ||
    node.kind() === "property_identifier" ||
    node.kind() === "type_identifier"
  ) {
    return [node.text()];
  }
  if (
    node.kind() !== "member_expression" &&
    node.kind() !== "nested_identifier" &&
    node.kind() !== "nested_type_identifier"
  ) {
    return null;
  }

  const parts: string[] = [];
  for (const child of node.children()) {
    if (!child.isNamed() || child.kind() === "comment") continue;
    const childPath = qualifiedPath(child);
    if (!childPath) return null;
    parts.push(...childPath);
  }
  return parts.length > 0 ? parts : null;
}

function dotPath(text: string): string[] {
  return text.split(".").filter(Boolean);
}

function startsWithPath(path: string[], prefix: string[]): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

function namespaceBindingPath(node: SgNode): string[] | null {
  const namespace = namespaceBindingModule(node);
  const name = namespace ? firstNamedChild(namespace) : undefined;
  if (name?.kind() !== "identifier" && name?.kind() !== "nested_identifier") return null;
  return qualifiedPath(name) ?? dotPath(name.text());
}

function namespaceStatementBlock(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() === "statement_block") ?? null;
}

function unwrapNamespaceMember(node: SgNode): SgNode | null {
  if (node.kind() === "export_statement") {
    return (
      node.children().find((child) => child.isNamed() && child.kind() !== "export_clause") ?? null
    );
  }
  if (node.kind() === "expression_statement") {
    const namedChildren = node.children().filter((child) => child.isNamed());
    return namedChildren.length === 1 ? namedChildren[0] : null;
  }
  return node;
}

function namespaceMemberPath(node: SgNode): string[] | null {
  const member = unwrapNamespaceMember(node);
  const name = member ? namespaceMemberName(member) : undefined;
  if (!name) return null;
  if (member?.kind() === "internal_module") return qualifiedPath(name) ?? dotPath(name.text());
  if (DECLARATION_PARENT_KINDS.has(member?.kind() ?? "")) return [name.text()];
  return null;
}

function namespaceMemberName(member: SgNode): SgNode | null {
  if (member.kind() === "lexical_declaration" || member.kind() === "variable_declaration") {
    const declarator = firstNamedChild(member);
    return declarator ? (firstNamedChild(declarator) ?? null) : null;
  }
  return firstNamedChild(member) ?? null;
}

function namespaceValueMemberPath(node: SgNode): string[] | null {
  const member = unwrapNamespaceMember(node);
  const name = member ? namespaceMemberName(member) : undefined;
  if (!member || !name) return null;
  if (member.kind() === "internal_module") {
    return hasRuntimeNamespaceMember(member) ? (qualifiedPath(name) ?? dotPath(name.text())) : null;
  }
  if (VALUE_NAMESPACE_MEMBER_KINDS.has(member.kind())) return [name.text()];
  return null;
}

function namespaceDeclaresPath(namespace: SgNode, path: string[]): boolean {
  if (path.length === 0) return true;

  const block = namespaceStatementBlock(namespace);
  if (!block) return false;

  for (const child of block.children()) {
    if (!child.isNamed()) continue;
    const member = unwrapNamespaceMember(child);
    if (!member) continue;

    const memberPath = namespaceMemberPath(member);
    if (!memberPath || !startsWithPath(path, memberPath)) continue;
    if (memberPath.length === path.length) return true;
    if (
      member.kind() === "internal_module" &&
      namespaceDeclaresPath(member, path.slice(memberPath.length))
    ) {
      return true;
    }
  }

  return false;
}

function namespaceDeclaresValuePath(namespace: SgNode, path: string[]): boolean {
  if (path.length === 0) return hasRuntimeNamespaceMember(namespace);

  const block = namespaceStatementBlock(namespace);
  if (!block) return false;

  for (const child of block.children()) {
    if (!child.isNamed()) continue;
    const member = unwrapNamespaceMember(child);
    if (!member) continue;

    const valuePath = namespaceValueMemberPath(member);
    if (valuePath && startsWithPath(path, valuePath) && valuePath.length === path.length) {
      return true;
    }

    const memberPath = namespaceMemberPath(member);
    if (
      member?.kind() === "internal_module" &&
      memberPath &&
      startsWithPath(path, memberPath) &&
      namespaceDeclaresValuePath(member, path.slice(memberPath.length))
    ) {
      return true;
    }
  }

  return false;
}

function namespaceBindingDeclaresPath(node: SgNode, path: string[]): boolean {
  const namespace = namespaceBindingModule(node);
  const namespacePath = namespaceBindingPath(node);
  if (!namespace || !namespacePath || !startsWithPath(path, namespacePath)) return false;
  return namespaceDeclaresPath(namespace, path.slice(namespacePath.length));
}

function namespaceBindingDeclaresValuePath(node: SgNode, path: string[]): boolean {
  const namespace = namespaceBindingModule(node);
  const namespacePath = namespaceBindingPath(node);
  if (!namespace || !namespacePath || !startsWithPath(path, namespacePath)) return false;
  return namespaceDeclaresValuePath(namespace, path.slice(namespacePath.length));
}

function isGlobalThisReference(
  node: SgNode,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  const reference = globalReferenceAncestor(node, globalThisAliases, aliasValueBindings);
  const object = reference ? globalThisReferenceObject(reference) : undefined;
  return (
    object != null && isGlobalThisLikeExpression(object, globalThisAliases, aliasValueBindings)
  );
}

function bindingShadowsReference(
  binding: BindingNamespace,
  reference: ReferenceNamespace,
): boolean {
  if (binding === "all") return true;
  if (binding === "both") return reference === "type" || reference === "value";
  if (binding === "namespace") return reference === "namespace" || reference === "value";
  if (binding === "type-namespace") return reference === "namespace";
  return binding === reference;
}

function isShadowedGlobalThisReference(
  node: SgNode,
  globalThisBindings: ScopedBinding[],
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  const reference = globalReferenceAncestor(node, globalThisAliases, aliasValueBindings);
  const object = reference ? globalThisReferenceObject(reference) : undefined;
  return object != null && isShadowedGlobalThisExpression(object, globalThisBindings);
}

function isShadowedReference(
  node: SgNode,
  bindings: ScopedBinding[],
  mergeRuntimeNamespaceAugmentations: boolean,
  globalThisAliases: ScopedBinding[] = [],
  aliasValueBindings: ScopedBinding[] = [],
): boolean {
  if (isGlobalThisReference(node, globalThisAliases, aliasValueBindings)) return false;
  const namespace = referenceNamespace(node, globalThisAliases, aliasValueBindings);
  return bindings.some((binding) => {
    if (binding.name !== node.text() || !containsNode(binding.scope, node)) return false;
    const runtimePath = runtimeNamespaceMemberPath(node, globalThisAliases, aliasValueBindings);
    if (
      mergeRuntimeNamespaceAugmentations &&
      binding.namespace === "type-namespace" &&
      runtimePath != null &&
      (namespace === "namespace" || namespace === "value")
    ) {
      if (namespace === "value") {
        if (namespaceBindingDeclaresValuePath(binding.node, runtimePath)) return true;
      } else if (namespaceBindingDeclaresPath(binding.node, runtimePath)) {
        return true;
      }
      if (namespace === "namespace") return false;
    }
    return bindingShadowsReference(binding.namespace, namespace);
  });
}

function unshadowedRuntimeGlobalReferences(
  root: SgNode,
  mergeRuntimeNamespaceAugmentations: boolean,
): SgNode[] {
  const bindings = localGlobalBindings(root);
  const globalThisBindings = localValueBindings(root, "globalThis");
  const globalThisAliases = globalThisAliasBindings(root, globalThisBindings);
  const aliasValueBindings = localValueBindingsForNames(
    root,
    new Set(globalThisAliases.map((alias) => alias.name)),
  );
  return globalNameNodes(root).filter(
    (node) =>
      isGlobalThisDestructuredProperty(
        node,
        globalThisBindings,
        globalThisAliases,
        aliasValueBindings,
      ) ||
      (isGlobalReference(node, globalThisAliases, aliasValueBindings) &&
        !isShadowedGlobalThisReference(
          node,
          globalThisBindings,
          globalThisAliases,
          aliasValueBindings,
        ) &&
        !isShadowedReference(
          node,
          bindings,
          mergeRuntimeNamespaceAugmentations,
          globalThisAliases,
          aliasValueBindings,
        )),
  );
}

function topLevelImports(root: SgNode): SgNode[] {
  return root.children().filter((node) => node.kind() === "import_statement");
}

function hasGlobalsImport(root: SgNode): boolean {
  return topLevelImports(root).some((node) => {
    return (
      node.text().includes(`"${GLOBALS_IMPORT_PATH}"`) ||
      node.text().includes(`'${GLOBALS_IMPORT_PATH}'`)
    );
  });
}

function hasGlobalsReference(source: string): boolean {
  let pos = 0;
  if (source.startsWith("#!")) {
    const firstLineEnd = source.indexOf("\n");
    pos = firstLineEnd === -1 ? source.length : firstLineEnd + 1;
  }

  while (pos < source.length) {
    const rest = source.slice(pos);
    const whitespace = rest.match(/^[ \t\r\n]+/);
    if (whitespace) {
      pos += whitespace[0].length;
      continue;
    }

    if (rest.startsWith("///")) {
      const end = rest.indexOf("\n");
      const comment = end === -1 ? rest : rest.slice(0, end);
      if (
        /^\/\/\/\s*<reference\s+types=["']@tailor-platform\/sdk\/runtime\/globals["']\s*\/>/.test(
          comment,
        )
      ) {
        return true;
      }
      pos += end === -1 ? rest.length : end + 1;
      continue;
    }

    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      pos += end === -1 ? rest.length : end + 1;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return false;
      pos += end + 2;
      continue;
    }

    return false;
  }

  return false;
}

function hasGlobalsOptIn(source: string, root: SgNode): boolean {
  return hasGlobalsImport(root) || hasGlobalsReference(source);
}

function isLineScopedPragmaComment(comment: string): boolean {
  return LINE_SCOPED_PRAGMA_PATTERN.test(comment);
}

function prologueEnd(source: string): number {
  let pos = 0;
  let consumedDirective = false;
  let lastDirectiveEnd = 0;
  if (source.startsWith("#!")) {
    const firstLineEnd = source.indexOf("\n");
    pos = firstLineEnd === -1 ? source.length : firstLineEnd + 1;
    lastDirectiveEnd = pos;
  }

  while (pos < source.length) {
    const rest = source.slice(pos);
    const whitespace = rest.match(/^[ \t\r\n]+/);
    if (whitespace) {
      pos += whitespace[0].length;
      continue;
    }

    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      const comment = end === -1 ? rest : rest.slice(0, end);
      if (isLineScopedPragmaComment(comment)) return consumedDirective ? lastDirectiveEnd : pos;
      pos += end === -1 ? rest.length : end + 1;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return pos;
      const comment = rest.slice(0, end + 2);
      if (isLineScopedPragmaComment(comment)) return consumedDirective ? lastDirectiveEnd : pos;
      pos += end + 2;
      continue;
    }

    const directive = rest.match(/^(['"])(?:\\.|(?!\1).)*\1[ \t]*;?[ \t]*/);
    if (!directive) return consumedDirective ? lastDirectiveEnd : pos;

    let directiveLength = directive[0].length;
    while (directiveLength < rest.length) {
      const trailing = rest.slice(directiveLength);
      const spacing = trailing.match(/^[ \t]+/);
      if (spacing) {
        directiveLength += spacing[0].length;
        continue;
      }

      const lineComment = trailing.match(/^\/\/[^\r\n]*/);
      if (lineComment) {
        directiveLength += lineComment[0].length;
        break;
      }

      const blockComment = trailing.match(/^\/\*[\s\S]*?\*\//);
      if (blockComment) {
        directiveLength += blockComment[0].length;
        continue;
      }

      break;
    }

    const afterDirective = rest.slice(directiveLength);
    const lineEnd = afterDirective.match(/^\r?\n|^$/);
    if (!lineEnd) return pos;
    pos += directiveLength;
    pos += lineEnd[0].length;
    consumedDirective = true;
    lastDirectiveEnd = pos;
  }

  return consumedDirective ? lastDirectiveEnd : pos;
}

function referenceDirectiveInsertPos(source: string): number {
  let pos = 0;
  if (source.startsWith("#!")) {
    const firstLineEnd = source.indexOf("\n");
    pos = firstLineEnd === -1 ? source.length : firstLineEnd + 1;
  }

  while (pos < source.length) {
    const rest = source.slice(pos);
    const whitespace = rest.match(/^[ \t\r\n]+/);
    if (whitespace) {
      pos += whitespace[0].length;
      continue;
    }

    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      const comment = end === -1 ? rest : rest.slice(0, end);
      if (isLineScopedPragmaComment(comment)) return pos;
      pos += end === -1 ? rest.length : end + 1;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return pos;
      const comment = rest.slice(0, end + 2);
      if (isLineScopedPragmaComment(comment)) return pos;
      pos += end + 2;
      continue;
    }

    return pos;
  }

  return pos;
}

function statementEndWithTrailingComments(
  source: string,
  statementStart: number,
  pos: number,
): number {
  let current = pos;
  while (current < source.length) {
    const rest = source.slice(current);
    const spacing = rest.match(/^[ \t]+/);
    if (spacing) {
      current += spacing[0].length;
      continue;
    }

    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      const comment = end === -1 ? rest : rest.slice(0, end);
      if (isLineScopedPragmaComment(comment)) return statementStart;
      return end === -1 ? source.length : current + end;
    }

    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return current;
      const comment = rest.slice(0, end + 2);
      if (isLineScopedPragmaComment(comment)) return statementStart;
      current += end + 2;
      continue;
    }

    break;
  }

  const lineEnd = source.indexOf("\n", current);
  return lineEnd === -1 ? source.length : lineEnd;
}

function addGlobalsImport(source: string, root: SgNode): string {
  const imports = topLevelImports(root);
  const lastImport = imports.at(-1);
  if (lastImport) {
    const importEnd = lastImport.range().end.index;
    const lineEnd = statementEndWithTrailingComments(
      source,
      lastImport.range().start.index,
      importEnd,
    );
    const insertPos = lineEnd === -1 ? source.length : lineEnd;
    if (insertPos === lastImport.range().start.index) {
      return `${source.slice(0, insertPos)}${GLOBALS_IMPORT}\n${source.slice(insertPos)}`;
    }
    return `${source.slice(0, insertPos)}\n${GLOBALS_IMPORT}${source.slice(insertPos)}`;
  }

  const insertPos = prologueEnd(source);
  const suffix = insertPos === 0 ? "\n\n" : "\n";
  return `${source.slice(0, insertPos)}${GLOBALS_IMPORT}${suffix}${source.slice(insertPos)}`;
}

function addGlobalsReference(source: string): string {
  const insertPos = referenceDirectiveInsertPos(source);
  const suffix = insertPos === 0 ? "\n\n" : "\n";
  return `${source.slice(0, insertPos)}${GLOBALS_REFERENCE}${suffix}${source.slice(insertPos)}`;
}

/**
 * Add the explicit side-effect import required for ambient runtime globals in v2.
 * @param source - File contents
 * @param filePath - Absolute path to the file
 * @returns Transformed source or null when no safe change is needed.
 */
export default function transform(source: string, filePath: string): string | null {
  const isDeclarationFile = /\.d\.[cm]?ts$/.test(filePath);
  const usesReferenceDirective = isDeclarationFile || filePath.endsWith(".cts");
  if (filePath.endsWith(".cjs")) return null;
  if (!GLOBAL_NAME_PATTERN.test(source)) return null;

  const root = parseSource(source, filePath).root();
  const mergeRuntimeNamespaceAugmentations = usesReferenceDirective || hasDeclareGlobalBlock(root);
  if (unshadowedRuntimeGlobalReferences(root, mergeRuntimeNamespaceAugmentations).length === 0) {
    return null;
  }
  if (hasGlobalsOptIn(source, root)) return null;
  if (usesReferenceDirective) return addGlobalsReference(source);

  return addGlobalsImport(source, root);
}
