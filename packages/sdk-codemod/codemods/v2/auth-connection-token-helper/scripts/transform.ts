import { parse, Lang } from "@ast-grep/napi";
import type { LlmReviewFinding } from "../../../../src/types";
import type { Edit, SgNode } from "@ast-grep/napi";

const RUNTIME_MODULE = "@tailor-platform/sdk/runtime";
const AUTHCONNECTION = "authconnection";
const GET_CONNECTION_TOKEN = "getConnectionToken";
const SOURCE_FILE_EXTENSIONS = new Set([".tsx", ".jsx"]);
const REFERENCE_KINDS = new Set([
  "identifier",
  "shorthand_property_identifier",
  "shorthand_property_identifier_pattern",
]);

interface ImportBinding {
  importStmt: SgNode;
  localName: string;
  importedName?: string;
  source: string;
  spec?: SgNode;
  namespace: boolean;
  typeOnly: boolean;
}

interface AuthBinding {
  importStmt: SgNode;
  localName: string;
  spec: SgNode;
}

interface TokenCall {
  objectNode: SgNode;
  localName: string;
  range: [number, number];
}

type BindingScopeMap = Map<string, Set<string>>;

function quickFilter(source: string): boolean {
  return source.includes(GET_CONNECTION_TOKEN) && source.includes("tailor.config");
}

function sourceLang(filePath: string, source: string): Lang {
  const lower = filePath.toLowerCase();
  const extension = lower.slice(lower.lastIndexOf("."));
  if (SOURCE_FILE_EXTENSIONS.has(extension)) return Lang.Tsx;
  if ([".js", ".mjs", ".cjs"].includes(extension) && source.includes("</")) return Lang.Tsx;
  return Lang.TypeScript;
}

function stringValue(node: SgNode | null): string | null {
  return node?.text().replace(/^['"]|['"]$/g, "") ?? null;
}

function isTypeOnlyImport(stmt: SgNode): boolean {
  return stmt.children().some((child) => child.kind() === "type");
}

function importSource(stmt: SgNode): string | null {
  return stringValue(stmt.find({ rule: { kind: "string" } }) ?? null);
}

function namedImportsNode(importStmt: SgNode): SgNode | null {
  return importStmt.find({ rule: { kind: "named_imports" } }) ?? null;
}

function isTailorConfigSource(source: string): boolean {
  return /(^|\/)tailor\.config(?:\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs))?$/.test(source);
}

function importSpecNames(
  spec: SgNode,
): { importedName: string; localName: string; typeOnly: boolean } | null {
  const ids = spec.children().filter((child) => child.kind() === "identifier");
  if (ids.length === 0) return null;
  return {
    importedName: ids[0]!.text(),
    localName: ids[1]?.text() ?? ids[0]!.text(),
    typeOnly: spec.children().some((child) => child.kind() === "type"),
  };
}

function importBindings(importStmt: SgNode): ImportBinding[] {
  const source = importSource(importStmt);
  if (!source) return [];

  const stmtTypeOnly = isTypeOnlyImport(importStmt);
  const clause = importStmt.children().find((child) => child.kind() === "import_clause");
  if (!clause) return [];

  const bindings: ImportBinding[] = [];
  for (const child of clause.children()) {
    if (child.kind() === "identifier") {
      bindings.push({
        importStmt,
        localName: child.text(),
        source,
        namespace: false,
        typeOnly: stmtTypeOnly,
      });
      continue;
    }

    if (child.kind() === "namespace_import") {
      const local = child.children().find((c) => c.kind() === "identifier");
      if (local) {
        bindings.push({
          importStmt,
          localName: local.text(),
          source,
          namespace: true,
          typeOnly: stmtTypeOnly,
        });
      }
      continue;
    }

    if (child.kind() !== "named_imports") continue;
    for (const spec of child.findAll({ rule: { kind: "import_specifier" } })) {
      const names = importSpecNames(spec);
      if (!names) continue;
      bindings.push({
        importStmt,
        spec,
        source,
        importedName: names.importedName,
        localName: names.localName,
        namespace: false,
        typeOnly: stmtTypeOnly || names.typeOnly,
      });
    }
  }

  return bindings;
}

function findImportStatements(root: SgNode): SgNode[] {
  return root
    .findAll({ rule: { kind: "import_statement" } })
    .filter((stmt) => stmt.parent()?.kind() === "program")
    .toSorted((a, b) => a.range().start.index - b.range().start.index);
}

function findTailorConfigAuthBindings(imports: SgNode[]): AuthBinding[] {
  return imports.flatMap((importStmt) =>
    importBindings(importStmt)
      .filter(
        (binding): binding is ImportBinding & { spec: SgNode; importedName: string } =>
          binding.spec != null &&
          binding.importedName === "auth" &&
          !binding.typeOnly &&
          isTailorConfigSource(binding.source),
      )
      .map((binding) => ({
        importStmt: binding.importStmt,
        localName: binding.localName,
        spec: binding.spec,
      })),
  );
}

function findTailorConfigNamespaceAuthLocalNames(imports: SgNode[]): Set<string> {
  return new Set(
    imports.flatMap((importStmt) =>
      importBindings(importStmt)
        .filter(
          (binding) =>
            (binding.namespace || binding.importedName == null) &&
            !binding.typeOnly &&
            isTailorConfigSource(binding.source),
        )
        .map((binding) => binding.localName),
    ),
  );
}

function initializerChild(decl: SgNode): SgNode | null {
  const children = decl.children();
  const equalIndex = children.findIndex((child) => child.kind() === "=");
  if (equalIndex === -1) return null;
  return (
    children.slice(equalIndex + 1).find((child) => child.kind() !== "," && child.kind() !== ";") ??
    null
  );
}

function requireCallSource(call: SgNode | null): string | null {
  if (call?.kind() !== "call_expression") return null;

  const callee = call.field("function");
  if (callee?.kind() !== "identifier" || callee.text() !== "require") return null;

  const args = call.children().find((child) => child.kind() === "arguments");
  const source = args?.children().find((child) => child.kind() === "string") ?? null;
  return stringValue(source);
}

function requireAuthMemberSource(member: SgNode | null): string | null {
  if (member?.kind() !== "member_expression") return null;

  const property = member.field("property");
  if (property?.text() !== "auth") return null;

  return requireCallSource(unwrapReceiverExpression(member.field("object")));
}

function objectPatternLocalNames(pattern: SgNode, importedName: string): string[] {
  const names: string[] = [];
  for (const child of pattern.children()) {
    if (child.kind() === "shorthand_property_identifier_pattern" && child.text() === importedName) {
      names.push(child.text());
      continue;
    }

    if (child.kind() !== "pair_pattern") continue;
    const property = child
      .children()
      .find((grandchild) => grandchild.kind() === "property_identifier");
    if (property?.text() !== importedName) continue;

    const binding = child.children().find((grandchild) => grandchild.kind() === "identifier");
    if (binding) names.push(binding.text());
  }
  return names;
}

function rangeKey(node: SgNode): string {
  const range = node.range();
  return `${range.start.index}:${range.end.index}`;
}

function addBindingScope(scopes: BindingScopeMap, localName: string, binding: SgNode): void {
  const scope = declarationScope(binding);
  if (!scope) return;
  const existing = scopes.get(localName) ?? new Set<string>();
  existing.add(rangeKey(scope));
  scopes.set(localName, existing);
}

function declarationScope(binding: SgNode): SgNode | null {
  let current = binding.parent();
  let variableDeclaration: SgNode | null = null;
  while (current) {
    if (current.kind() === "variable_declaration") {
      variableDeclaration = current;
      break;
    }
    current = current.parent();
  }

  const isVar = variableDeclaration?.children().some((child) => child.kind() === "var") ?? false;
  current = binding.parent();
  while (current) {
    if (
      isVar &&
      (current.kind() === "program" ||
        current.children().some((child) => child.kind() === "formal_parameters"))
    ) {
      return current;
    }

    if (
      !isVar &&
      ["program", "statement_block", "switch_case", "switch_default"].includes(current.kind())
    ) {
      return current;
    }
    current = current.parent();
  }
  return null;
}

function bindingScopeLocalNames(scopes: BindingScopeMap): Set<string> {
  return new Set(scopes.keys());
}

function findTailorConfigRequireAuthBindingScopes(root: SgNode): BindingScopeMap {
  const scopes: BindingScopeMap = new Map();
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    const initializer = initializerChild(decl);
    if (binding?.kind() === "object_pattern") {
      const source = requireCallSource(initializer);
      if (!source || !isTailorConfigSource(source)) continue;
      for (const localName of objectPatternLocalNames(binding, "auth")) {
        addBindingScope(scopes, localName, binding);
      }
      continue;
    }

    if (binding?.kind() === "identifier") {
      const source = requireAuthMemberSource(initializer);
      if (source && isTailorConfigSource(source)) addBindingScope(scopes, binding.text(), binding);
    }
  }
  return scopes;
}

function findTailorConfigRequireNamespaceAuthBindingScopes(root: SgNode): BindingScopeMap {
  const scopes: BindingScopeMap = new Map();
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    if (binding?.kind() !== "identifier") continue;
    const source = requireCallSource(initializerChild(decl));
    if (source && isTailorConfigSource(source)) addBindingScope(scopes, binding.text(), binding);
  }
  return scopes;
}

function runtimeAuthconnectionReference(imports: SgNode[]): string | null {
  for (const importStmt of imports) {
    for (const binding of importBindings(importStmt)) {
      if (binding.source !== RUNTIME_MODULE || binding.typeOnly) continue;
      if (binding.importedName === AUTHCONNECTION) return binding.localName;
      if (binding.namespace) return `${binding.localName}.${AUTHCONNECTION}`;
    }
  }
  return null;
}

function runtimeNamedValueImport(imports: SgNode[]): SgNode | null {
  return (
    imports.find(
      (stmt) =>
        importSource(stmt) === RUNTIME_MODULE && !isTypeOnlyImport(stmt) && namedImportsNode(stmt),
    ) ?? null
  );
}

function collectBindingNames(node: SgNode, out: Set<string>): void {
  const kind = node.kind();
  if (
    kind === "identifier" ||
    kind === "type_identifier" ||
    kind === "shorthand_property_identifier_pattern"
  ) {
    out.add(node.text());
    return;
  }

  const children = node.children();
  const defaultIndex = children.findIndex((child) => child.kind() === "=");
  for (const child of defaultIndex === -1 ? children : children.slice(0, defaultIndex)) {
    if (child.kind() === "property_identifier") continue;
    collectBindingNames(child, out);
  }
}

function firstDeclaratorChild(node: SgNode): SgNode | null {
  return node.children().find((child) => child.kind() !== "=") ?? null;
}

function localDeclarationNames(root: SgNode): Set<string> {
  const names = new Set<string>();

  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const binding = firstDeclaratorChild(decl);
    if (binding) collectBindingNames(binding, names);
  }

  for (const stmt of root.findAll({ rule: { kind: "expression_statement" } })) {
    collectUsingDeclarationNames(stmt, names);
  }

  for (const param of root.findAll({
    rule: { any: [{ kind: "required_parameter" }, { kind: "optional_parameter" }] },
  })) {
    const binding = param
      .children()
      .find((child) =>
        ["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind()),
      );
    if (binding) collectBindingNames(binding, names);
  }

  for (const decl of root.findAll({
    rule: {
      any: [
        { kind: "function_declaration" },
        { kind: "function_expression" },
        { kind: "class_declaration" },
        { kind: "class" },
        { kind: "enum_declaration" },
        { kind: "interface_declaration" },
        { kind: "type_alias_declaration" },
        { kind: "internal_module" },
        { kind: "import_alias" },
      ],
    },
  })) {
    collectDeclarationName(decl, names);
  }

  for (const catchClause of root.findAll({ rule: { kind: "catch_clause" } })) {
    for (const child of catchClause.children()) {
      if (["identifier", "object_pattern", "array_pattern"].includes(child.kind())) {
        collectBindingNames(child, names);
      }
    }
  }

  for (const arrow of root.findAll({ rule: { kind: "arrow_function" } })) {
    const children = arrow.children();
    const arrowIndex = children.findIndex((child) => child.kind() === "=>");
    if (arrowIndex === -1) continue;
    for (const child of children.slice(0, arrowIndex)) {
      collectBindingNames(child, names);
    }
  }

  for (const loop of root.findAll({ rule: { kind: "for_in_statement" } })) {
    const children = loop.children();
    const keywordIndex = children.findIndex(
      (child) => child.kind() === "in" || child.kind() === "of",
    );
    if (keywordIndex === -1) continue;
    for (const child of children.slice(0, keywordIndex)) {
      collectBindingNames(child, names);
    }
  }

  return names;
}

function hasRuntimeImportCollision(localNames: Set<string>, imports: SgNode[]): boolean {
  if (localNames.has(AUTHCONNECTION)) return true;

  return imports.some(
    (importStmt) =>
      importEqualsLocalName(importStmt) === AUTHCONNECTION ||
      importBindings(importStmt).some(
        (binding) =>
          binding.localName === AUTHCONNECTION &&
          !(
            binding.source === RUNTIME_MODULE &&
            binding.importedName === AUTHCONNECTION &&
            !binding.namespace &&
            !binding.typeOnly
          ),
      ),
  );
}

function importEqualsLocalName(importStmt: SgNode): string | null {
  const clause = importStmt.children().find((child) => child.kind() === "import_require_clause");
  return (
    clause
      ?.children()
      .find((child) => child.kind() === "identifier")
      ?.text() ?? null
  );
}

function hasRuntimeReferenceShadow(localNames: Set<string>, runtimeRef: string): boolean {
  return localNames.has(runtimeRef.split(".")[0]!);
}

function collectVariableDeclaratorNames(scope: SgNode, names: Set<string>): void {
  for (const decl of scope.children().filter((child) => child.kind() === "variable_declarator")) {
    const binding = firstDeclaratorChild(decl);
    if (binding) collectBindingNames(binding, names);
  }
}

function collectParameterNames(scope: SgNode, names: Set<string>): void {
  const params = scope.children().find((child) => child.kind() === "formal_parameters");
  if (!params) return;

  collectFormalParameterNames(params, names);
}

function collectFormalParameterNames(params: SgNode, names: Set<string>): void {
  for (const param of params.children()) {
    const binding = param
      .children()
      .find((child) =>
        ["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind()),
      );
    if (binding) collectBindingNames(binding, names);
  }
}

function collectArrowParameterNames(scope: SgNode, names: Set<string>): void {
  const children = scope.children();
  const arrowIndex = children.findIndex((child) => child.kind() === "=>");
  if (arrowIndex === -1) return;

  for (const child of children.slice(0, arrowIndex)) {
    if (child.kind() === "formal_parameters") {
      collectFormalParameterNames(child, names);
      continue;
    }

    if (["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind())) {
      collectBindingNames(child, names);
    }
  }
}

function collectDirectBlockNames(scope: SgNode, names: Set<string>): void {
  for (const child of scope.children()) {
    if (child.kind() === "export_statement") {
      collectDirectBlockNames(child, names);
      continue;
    }

    if (child.kind() === "expression_statement") {
      const moduleDecl = child
        .children()
        .find((grandchild) => grandchild.kind() === "internal_module");
      if (moduleDecl) collectDeclarationName(moduleDecl, names);
      collectUsingDeclarationNames(child, names);
      continue;
    }

    if (child.kind() === "lexical_declaration" || child.kind() === "variable_declaration") {
      collectVariableDeclaratorNames(child, names);
      continue;
    }

    if (
      [
        "function_declaration",
        "class_declaration",
        "enum_declaration",
        "internal_module",
        "import_alias",
      ].includes(child.kind())
    ) {
      collectDeclarationName(child, names);
    }
  }
}

function collectDeclarationName(node: SgNode, names: Set<string>): void {
  const name = node
    .children()
    .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
  if (name) names.add(name.text());
}

function collectUsingDeclarationNames(scope: SgNode, names: Set<string>): void {
  const assignments = scope.children().flatMap((child) => {
    if (child.kind() === "assignment_expression") return [child];
    if (child.kind() !== "await_expression") return [];
    const assignment = child
      .children()
      .find((grandchild) => grandchild.kind() === "assignment_expression");
    return assignment ? [assignment] : [];
  });

  for (const assignment of assignments) {
    const children = assignment.children();
    const usingIndex = children.findIndex((child) => child.kind() === "using");
    const end = children.findIndex((child, index) => index > usingIndex && child.kind() === "=");
    if (usingIndex === -1 || end === -1) continue;

    for (const child of children.slice(usingIndex + 1, end)) {
      if (
        ["identifier", "object_pattern", "array_pattern", "rest_pattern"].includes(child.kind())
      ) {
        collectBindingNames(child, names);
      }
    }
  }
}

function collectSwitchBodyNames(scope: SgNode, names: Set<string>): void {
  for (const child of scope.children()) {
    if (child.kind() === "switch_case" || child.kind() === "switch_default") {
      collectDirectBlockNames(child, names);
    }
  }
}

function collectForInitializerNames(scope: SgNode, names: Set<string>): void {
  const children = scope.children();
  const start = children.findIndex((child) => child.kind() === "(");
  const end = children.findIndex((child, index) => index > start && child.kind() === ";");
  if (start === -1 || end === -1) return;

  for (const child of children.slice(start + 1, end)) {
    if (child.kind() === "lexical_declaration" || child.kind() === "variable_declaration") {
      collectVariableDeclaratorNames(child, names);
    }
  }
}

function isNestedFunctionOrClassScope(scope: SgNode): boolean {
  return (
    [
      "function_declaration",
      "function_expression",
      "arrow_function",
      "method_definition",
      "class_declaration",
      "class",
    ].includes(scope.kind()) ||
    scope.children().some((child) => child.kind() === "formal_parameters")
  );
}

function isVarDeclaration(scope: SgNode): boolean {
  return (
    scope.kind() === "variable_declaration" &&
    scope.children().some((child) => child.kind() === "var")
  );
}

function collectFunctionScopedVarNames(scope: SgNode, names: Set<string>): void {
  for (const child of scope.children()) {
    if (isNestedFunctionOrClassScope(child)) continue;

    if (isVarDeclaration(child)) {
      collectVariableDeclaratorNames(child, names);
    }

    collectFunctionScopedVarNames(child, names);
  }
}

function collectOwnExpressionName(scope: SgNode, names: Set<string>): void {
  if (scope.kind() === "function_expression" || scope.kind() === "function_declaration") {
    const name = scope.children().find((child) => child.kind() === "identifier");
    if (name) names.add(name.text());
    return;
  }

  if (scope.kind() === "class" || scope.kind() === "class_declaration") {
    const name = scope
      .children()
      .find((child) => child.kind() === "identifier" || child.kind() === "type_identifier");
    if (name) names.add(name.text());
    return;
  }

  if (scope.kind() === "internal_module") {
    collectDeclarationName(scope, names);
  }
}

function isInsideFormalParameters(node: SgNode, scope: SgNode): boolean {
  const params = scope.children().find((child) => child.kind() === "formal_parameters");
  if (!params) return false;

  const nodeStart = node.range().start.index;
  const paramsRange = params.range();
  return nodeStart >= paramsRange.start.index && nodeStart < paramsRange.end.index;
}

function directlyDeclaredNames(scope: SgNode, reference: SgNode): Set<string> {
  const names = new Set<string>();
  const kind = scope.kind();
  const referenceInParameters = isInsideFormalParameters(reference, scope);

  collectOwnExpressionName(scope, names);

  if (scope.children().some((child) => child.kind() === "formal_parameters")) {
    collectParameterNames(scope, names);
    if (!referenceInParameters) collectFunctionScopedVarNames(scope, names);
  }

  if (kind === "arrow_function") {
    if (!referenceInParameters) collectFunctionScopedVarNames(scope, names);
    collectArrowParameterNames(scope, names);
  } else if (kind === "catch_clause") {
    for (const child of scope.children()) {
      if (["identifier", "object_pattern", "array_pattern"].includes(child.kind())) {
        collectBindingNames(child, names);
      }
    }
  } else if (["statement_block", "program", "switch_case", "switch_default"].includes(kind)) {
    collectDirectBlockNames(scope, names);
  } else if (kind === "switch_body") {
    collectSwitchBodyNames(scope, names);
  } else if (kind === "for_statement") {
    collectForInitializerNames(scope, names);
  } else if (kind === "for_in_statement") {
    const children = scope.children();
    const keywordIndex = children.findIndex(
      (child) => child.kind() === "in" || child.kind() === "of",
    );
    if (keywordIndex !== -1) {
      for (const child of children.slice(0, keywordIndex)) {
        collectBindingNames(child, names);
      }
    }
  }

  return names;
}

function isReferenceShadowed(
  node: SgNode,
  localName: string,
  allowedBindingScopes: BindingScopeMap = new Map(),
): boolean {
  let current = node.parent();
  while (current) {
    if (directlyDeclaredNames(current, node).has(localName)) {
      if (allowedBindingScopes.get(localName)?.has(rangeKey(current))) {
        current = current.parent();
        continue;
      }
      return true;
    }
    current = current.parent();
  }
  return false;
}

function authConnectionTokenReferenceFromMember(
  member: SgNode,
  authLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall | null {
  const property = member.field("property");
  const object = member.field("object");
  const receiver = authReceiverIdentifier(object);
  if (
    property?.text() !== GET_CONNECTION_TOKEN ||
    !object ||
    !receiver ||
    !authLocalNames.has(receiver.text())
  ) {
    return null;
  }

  if (isReferenceShadowed(receiver, receiver.text(), allowedBindingScopes)) return null;

  const range = object.range();
  return {
    objectNode: object,
    localName: receiver.text(),
    range: [range.start.index, range.end.index],
  };
}

function authReceiverIdentifier(node: SgNode | null): SgNode | null {
  const receiver = unwrapReceiverExpression(node);
  return receiver?.kind() === "identifier" ? receiver : null;
}

function unwrapReceiverExpression(node: SgNode | null): SgNode | null {
  if (!node) return null;
  if (
    ![
      "parenthesized_expression",
      "as_expression",
      "satisfies_expression",
      "non_null_expression",
      "type_assertion",
    ].includes(node.kind())
  ) {
    return node;
  }

  for (const child of node.children()) {
    if (
      ![
        "identifier",
        "member_expression",
        "parenthesized_expression",
        "as_expression",
        "satisfies_expression",
        "non_null_expression",
        "type_assertion",
      ].includes(child.kind())
    ) {
      continue;
    }
    const receiver = unwrapReceiverExpression(child);
    if (receiver) return receiver;
  }
  return null;
}

function findAuthConnectionTokenReferences(
  root: SgNode,
  authLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall[] {
  const references: TokenCall[] = [];
  for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
    const reference = authConnectionTokenReferenceFromMember(
      member,
      authLocalNames,
      allowedBindingScopes,
    );
    if (reference) references.push(reference);
  }
  return references;
}

function authConnectionTokenNamespaceReferenceFromMember(
  member: SgNode,
  namespaceAuthLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall | null {
  const property = member.field("property");
  const object = member.field("object");
  const receiver = namespaceAuthReceiverIdentifier(object, namespaceAuthLocalNames);
  if (property?.text() !== GET_CONNECTION_TOKEN || !object || !receiver) return null;
  if (isReferenceShadowed(receiver, receiver.text(), allowedBindingScopes)) return null;

  const range = object.range();
  return {
    objectNode: object,
    localName: receiver.text(),
    range: [range.start.index, range.end.index],
  };
}

function namespaceAuthReceiverIdentifier(
  node: SgNode | null,
  namespaceAuthLocalNames: Set<string>,
): SgNode | null {
  const receiver = unwrapReceiverExpression(node);
  if (receiver?.kind() !== "member_expression") return null;

  const property = receiver.field("property");
  const object = receiver.field("object");
  if (
    property?.text() !== "auth" ||
    object?.kind() !== "identifier" ||
    !namespaceAuthLocalNames.has(object.text())
  ) {
    return null;
  }
  return object;
}

function findAuthConnectionTokenNamespaceReferences(
  root: SgNode,
  namespaceAuthLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall[] {
  const references: TokenCall[] = [];
  for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
    const reference = authConnectionTokenNamespaceReferenceFromMember(
      member,
      namespaceAuthLocalNames,
      allowedBindingScopes,
    );
    if (reference) references.push(reference);
  }
  return references;
}

function isGetConnectionTokenSubscript(subscript: SgNode): boolean {
  return stringValue(subscript.field("index")) === GET_CONNECTION_TOKEN;
}

function authConnectionTokenSubscriptReferenceFromSubscript(
  subscript: SgNode,
  authLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall | null {
  const object = subscript.field("object");
  const receiver = authReceiverIdentifier(object);
  if (!isGetConnectionTokenSubscript(subscript) || !object || !receiver) return null;
  if (!authLocalNames.has(receiver.text())) return null;
  if (isReferenceShadowed(receiver, receiver.text(), allowedBindingScopes)) return null;

  const range = subscript.range();
  return {
    objectNode: object,
    localName: receiver.text(),
    range: [range.start.index, range.end.index],
  };
}

function findAuthConnectionTokenSubscriptReferences(
  root: SgNode,
  authLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall[] {
  const references: TokenCall[] = [];
  for (const subscript of root.findAll({ rule: { kind: "subscript_expression" } })) {
    const reference = authConnectionTokenSubscriptReferenceFromSubscript(
      subscript,
      authLocalNames,
      allowedBindingScopes,
    );
    if (reference) references.push(reference);
  }
  return references;
}

function authConnectionTokenNamespaceSubscriptReferenceFromSubscript(
  subscript: SgNode,
  namespaceAuthLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall | null {
  const object = subscript.field("object");
  const receiver = namespaceAuthReceiverIdentifier(object, namespaceAuthLocalNames);
  if (!isGetConnectionTokenSubscript(subscript) || !object || !receiver) return null;
  if (isReferenceShadowed(receiver, receiver.text(), allowedBindingScopes)) return null;

  const range = subscript.range();
  return {
    objectNode: object,
    localName: receiver.text(),
    range: [range.start.index, range.end.index],
  };
}

function findAuthConnectionTokenNamespaceSubscriptReferences(
  root: SgNode,
  namespaceAuthLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall[] {
  const references: TokenCall[] = [];
  for (const subscript of root.findAll({ rule: { kind: "subscript_expression" } })) {
    const reference = authConnectionTokenNamespaceSubscriptReferenceFromSubscript(
      subscript,
      namespaceAuthLocalNames,
      allowedBindingScopes,
    );
    if (reference) references.push(reference);
  }
  return references;
}

function objectPatternHasGetConnectionToken(pattern: SgNode): boolean {
  return pattern.children().some((child) => {
    if (
      child.kind() === "shorthand_property_identifier_pattern" &&
      child.text() === GET_CONNECTION_TOKEN
    ) {
      return true;
    }

    if (child.kind() !== "pair_pattern") return false;
    return pairPatternKeyName(child) === GET_CONNECTION_TOKEN;
  });
}

function pairPatternKeyName(pair: SgNode): string | null {
  for (const child of pair.children()) {
    if (child.kind() === ":") return null;
    if (child.kind() === "property_identifier") return child.text();
    if (child.kind() === "computed_property_name") {
      return stringValue(
        child.children().find((grandchild) => grandchild.kind() === "string") ?? null,
      );
    }
  }
  return null;
}

function authConnectionTokenDestructureReference(
  node: SgNode,
  binding: SgNode | null,
  initializer: SgNode | null,
  authLocalNames: Set<string>,
  namespaceAuthLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap,
  namespaceAllowedBindingScopes: BindingScopeMap,
): TokenCall | null {
  if (binding?.kind() !== "object_pattern" || !objectPatternHasGetConnectionToken(binding)) {
    return null;
  }

  const authReceiver = authReceiverIdentifier(initializer);
  const namespaceReceiver = namespaceAuthReceiverIdentifier(initializer, namespaceAuthLocalNames);
  const receiver =
    authReceiver && authLocalNames.has(authReceiver.text()) ? authReceiver : namespaceReceiver;
  const receiverAllowedScopes =
    receiver === authReceiver ? allowedBindingScopes : namespaceAllowedBindingScopes;
  if (!receiver) return null;
  if (isReferenceShadowed(receiver, receiver.text(), receiverAllowedScopes)) return null;

  const range = node.range();
  return {
    objectNode: initializer ?? receiver,
    localName: receiver.text(),
    range: [range.start.index, range.end.index],
  };
}

function findAuthConnectionTokenDestructures(
  root: SgNode,
  authLocalNames: Set<string>,
  namespaceAuthLocalNames: Set<string>,
  allowedBindingScopes: BindingScopeMap = new Map(),
  namespaceAllowedBindingScopes: BindingScopeMap = new Map(),
): TokenCall[] {
  const references: TokenCall[] = [];
  for (const decl of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const reference = authConnectionTokenDestructureReference(
      decl,
      firstDeclaratorChild(decl),
      initializerChild(decl),
      authLocalNames,
      namespaceAuthLocalNames,
      allowedBindingScopes,
      namespaceAllowedBindingScopes,
    );
    if (reference) references.push(reference);
  }

  for (const assignment of root.findAll({ rule: { kind: "assignment_expression" } })) {
    const reference = authConnectionTokenDestructureReference(
      assignment,
      firstDeclaratorChild(assignment),
      initializerChild(assignment),
      authLocalNames,
      namespaceAuthLocalNames,
      allowedBindingScopes,
      namespaceAllowedBindingScopes,
    );
    if (reference) references.push(reference);
  }
  return references;
}

function findAuthConnectionTokenCalls(root: SgNode, authLocalNames: Set<string>): TokenCall[] {
  const calls: TokenCall[] = [];
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function");
    if (callee?.kind() !== "member_expression") continue;

    const reference = authConnectionTokenReferenceFromMember(callee, authLocalNames);
    if (reference) calls.push(reference);
  }
  return calls;
}

function isInsideImportStatement(node: SgNode): boolean {
  let current: SgNode | null = node.parent();
  while (current) {
    if (current.kind() === "import_statement") return true;
    current = current.parent();
  }
  return false;
}

function isInsideScheduledRange(node: SgNode, ranges: Array<[number, number]>): boolean {
  const start = node.range().start.index;
  return ranges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd);
}

function countRemainingRefs(
  root: SgNode,
  localName: string,
  scheduledRanges: Array<[number, number]>,
): number {
  return root
    .findAll({ rule: { any: [...REFERENCE_KINDS].map((kind) => ({ kind })) } })
    .filter((node) => node.text() === localName)
    .filter(
      (node) =>
        !isInsideImportStatement(node) &&
        !isInsideScheduledRange(node, scheduledRanges) &&
        !isReferenceShadowed(node, localName),
    ).length;
}

function importClause(importStmt: SgNode): SgNode | null {
  return importStmt.children().find((child) => child.kind() === "import_clause") ?? null;
}

function hasDefaultOrNamespaceImport(importStmt: SgNode): boolean {
  return (
    importClause(importStmt)
      ?.children()
      .some((child) => child.kind() === "identifier" || child.kind() === "namespace_import") ??
    false
  );
}

function buildOnlyNamedImportRemovalEdit(source: string, importStmt: SgNode): Edit | null {
  const named = namedImportsNode(importStmt);
  if (!named) return null;

  let start = skipBackwardImportTrivia(source, named.range().start.index);
  const end = named.range().end.index;
  if (source[start - 1] === ",") {
    start--;
    start = skipBackwardImportTrivia(source, start);
  }
  return { startPos: start, endPos: end, insertedText: "" };
}

function skipBackwardImportTrivia(source: string, index: number): number {
  let pos = index;
  while (pos > 0) {
    while (pos > 0 && /\s/.test(source[pos - 1]!)) pos--;

    if (source.slice(pos - 2, pos) === "*/") {
      const start = source.lastIndexOf("/*", pos - 2);
      if (start === -1) return pos;
      pos = start;
      continue;
    }

    return pos;
  }
  return pos;
}

function skipInlineTrivia(source: string, index: number): number {
  let pos = index;
  while (pos < source.length) {
    while (pos < source.length && (source[pos] === " " || source[pos] === "\t")) pos++;

    if (source.startsWith("/*", pos)) {
      const end = source.indexOf("*/", pos + 2);
      if (end === -1) return pos;
      pos = end + 2;
      continue;
    }

    if (source.startsWith("//", pos)) {
      const end = source.indexOf("\n", pos + 2);
      pos = end === -1 ? source.length : end + 1;
      continue;
    }

    return pos;
  }
  return pos;
}

function buildImportSpecRemovalEdit(source: string, binding: AuthBinding): Edit | null {
  const allSpecs = binding.importStmt.findAll({ rule: { kind: "import_specifier" } });
  if (allSpecs.length === 1) {
    if (hasDefaultOrNamespaceImport(binding.importStmt)) {
      return buildOnlyNamedImportRemovalEdit(source, binding.importStmt);
    }

    const r = binding.importStmt.range();
    return { startPos: r.start.index, endPos: r.end.index, insertedText: "" };
  }

  const r = binding.spec.range();
  let start = r.start.index;
  let end = r.end.index;
  end = skipInlineTrivia(source, end);
  if (source[end] === ",") {
    end++;
    while (end < source.length && (source[end] === " " || source[end] === "\t")) end++;
    return { startPos: start, endPos: end, insertedText: "" };
  }

  while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
  if (source[start - 1] === ",") {
    start--;
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    return { startPos: start, endPos: end, insertedText: "" };
  }

  return { startPos: r.start.index, endPos: r.end.index, insertedText: "" };
}

function importRangeKey(importStmt: SgNode): string {
  const range = importStmt.range();
  return `${range.start.index}:${range.end.index}`;
}

function buildGroupedImportSpecRemovalEdits(
  source: string,
  importStmt: SgNode,
  bindings: AuthBinding[],
): Edit[] {
  const allSpecs = importStmt.findAll({ rule: { kind: "import_specifier" } });
  const removableSpecStarts = new Set(bindings.map((binding) => binding.spec.range().start.index));

  if (removableSpecStarts.size === allSpecs.length) {
    if (hasDefaultOrNamespaceImport(importStmt)) {
      const edit = buildOnlyNamedImportRemovalEdit(source, importStmt);
      return edit ? [edit] : [];
    }

    const range = importStmt.range();
    return [{ startPos: range.start.index, endPos: range.end.index, insertedText: "" }];
  }

  if (bindings.length === 1) {
    const edit = buildImportSpecRemovalEdit(source, bindings[0]!);
    return edit ? [edit] : [];
  }

  const named = namedImportsNode(importStmt);
  if (!named) return [];

  const keptSpecTexts = allSpecs
    .filter((spec) => !removableSpecStarts.has(spec.range().start.index))
    .map((spec) => spec.text());
  return [named.replace(`{ ${keptSpecTexts.join(", ")} }`)];
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
  const existingRuntimeImport = runtimeNamedValueImport(imports);
  const namedImports = existingRuntimeImport ? namedImportsNode(existingRuntimeImport) : null;
  if (namedImports) {
    const specTexts = namedImports
      .findAll({ rule: { kind: "import_specifier" } })
      .map((spec) => spec.text());
    return namedImports.replace(`{ ${[...specTexts, AUTHCONNECTION].join(", ")} }`);
  }

  const pos = importInsertionIndex(root, imports, source);
  const insertedText =
    pos === 0 || source[pos - 1] === "\n"
      ? `import { ${AUTHCONNECTION} } from "${RUNTIME_MODULE}";\n\n`
      : `\nimport { ${AUTHCONNECTION} } from "${RUNTIME_MODULE}";`;
  return { startPos: pos, endPos: pos, insertedText };
}

function applyEdits(source: string, edits: Edit[]): string {
  return edits
    .toSorted((a, b) => b.startPos - a.startPos || b.endPos - a.endPos)
    .reduce(
      (current, edit) =>
        `${current.slice(0, edit.startPos)}${edit.insertedText}${current.slice(edit.endPos)}`,
      source,
    );
}

function normalizeSource(source: string): string {
  const lines = source.replace(/^[\t ]*\n+/, "").split("\n");
  const out: string[] = [];
  let sawImport = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith("import ")) {
      out.push(line);
      sawImport = true;
      continue;
    }
    if (sawImport && line.trim() === "") {
      if (out.at(-1)?.trim() !== "") out.push(line);
      continue;
    }
    out.push(...lines.slice(index));
    return out.join("\n");
  }

  return out.join("\n");
}

function transformParsed(source: string, root: SgNode): string | null {
  const imports = findImportStatements(root);
  const localNames = localDeclarationNames(root);
  const authBindings = findTailorConfigAuthBindings(imports);
  if (authBindings.length === 0) return null;

  const authLocalNames = new Set(authBindings.map((binding) => binding.localName));
  const calls = findAuthConnectionTokenCalls(root, authLocalNames);
  if (calls.length === 0) return null;

  const existingRuntimeRef = runtimeAuthconnectionReference(imports);
  if (!existingRuntimeRef && hasRuntimeImportCollision(localNames, imports)) return null;
  if (existingRuntimeRef && hasRuntimeReferenceShadow(localNames, existingRuntimeRef)) return null;

  const runtimeRef = existingRuntimeRef ?? AUTHCONNECTION;
  const edits: Edit[] = calls.map((call) => call.objectNode.replace(runtimeRef));

  if (!existingRuntimeRef) {
    edits.push(buildAddRuntimeImportEdit(root, source, imports));
  }

  const scheduledRangesByLocalName = new Map<string, Array<[number, number]>>();
  for (const call of calls) {
    const ranges = scheduledRangesByLocalName.get(call.localName) ?? [];
    ranges.push(call.range);
    scheduledRangesByLocalName.set(call.localName, ranges);
  }

  const removableBindingsByImport = new Map<
    string,
    { importStmt: SgNode; bindings: AuthBinding[] }
  >();
  for (const binding of authBindings) {
    if (calls.every((call) => call.localName !== binding.localName)) continue;
    const remainingRefs = countRemainingRefs(
      root,
      binding.localName,
      scheduledRangesByLocalName.get(binding.localName) ?? [],
    );
    if (remainingRefs > 0) continue;
    const key = importRangeKey(binding.importStmt);
    const group = removableBindingsByImport.get(key) ?? {
      importStmt: binding.importStmt,
      bindings: [],
    };
    group.bindings.push(binding);
    removableBindingsByImport.set(key, group);
  }

  for (const group of removableBindingsByImport.values()) {
    edits.push(...buildGroupedImportSpecRemovalEdits(source, group.importStmt, group.bindings));
  }

  const result = normalizeSource(applyEdits(source, edits));
  return result === source ? null : result;
}

function parseRoot(source: string, filePath: string): SgNode | null {
  if (!quickFilter(source)) return null;
  try {
    return parse(sourceLang(filePath, source), source).root();
  } catch {
    return null;
  }
}

export default function transform(source: string, filePath: string): string | null {
  const root = parseRoot(source, filePath);
  return root ? transformParsed(source, root) : null;
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r\n|\r|\n/).length;
}

function excerptForIndex(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = source.indexOf("\n", index);
  return source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
}

export function reviewFindings(
  source: string,
  filePath: string,
  relativePath: string,
): LlmReviewFinding[] {
  const root = parseRoot(source, filePath);
  if (!root) return [];

  const imports = findImportStatements(root);
  const authBindings = findTailorConfigAuthBindings(imports);
  const requireAuthBindingScopes = findTailorConfigRequireAuthBindingScopes(root);
  const requireNamespaceAuthBindingScopes = findTailorConfigRequireNamespaceAuthBindingScopes(root);
  const authLocalNames = new Set([
    ...authBindings.map((binding) => binding.localName),
    ...bindingScopeLocalNames(requireAuthBindingScopes),
  ]);
  const namespaceAuthLocalNames = new Set([
    ...findTailorConfigNamespaceAuthLocalNames(imports),
    ...bindingScopeLocalNames(requireNamespaceAuthBindingScopes),
  ]);
  const references = [
    ...findAuthConnectionTokenReferences(root, authLocalNames, requireAuthBindingScopes),
    ...findAuthConnectionTokenNamespaceReferences(
      root,
      namespaceAuthLocalNames,
      requireNamespaceAuthBindingScopes,
    ),
    ...findAuthConnectionTokenSubscriptReferences(root, authLocalNames, requireAuthBindingScopes),
    ...findAuthConnectionTokenNamespaceSubscriptReferences(
      root,
      namespaceAuthLocalNames,
      requireNamespaceAuthBindingScopes,
    ),
    ...findAuthConnectionTokenDestructures(
      root,
      authLocalNames,
      namespaceAuthLocalNames,
      requireAuthBindingScopes,
      requireNamespaceAuthBindingScopes,
    ),
  ].toSorted((a, b) => a.range[0] - b.range[0]);

  return references.map((reference) => ({
    file: relativePath,
    line: lineForIndex(source, reference.range[0]),
    message: "Replace defineAuth auth.getConnectionToken() with runtime authconnection.",
    excerpt: excerptForIndex(source, reference.range[0]),
  }));
}
