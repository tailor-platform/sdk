import { parse, Lang } from "@ast-grep/napi";
import type { Edit, SgNode } from "@ast-grep/napi";

const TYPE_RENAME_MAP: Record<string, string> = {
  TailorUser: "TailorPrincipal",
  TailorActor: "TailorPrincipal",
  TailorInvoker: "TailorPrincipal",
};

const UNAUTHENTICATED = "unauthenticatedTailorUser";

const QUICK_FILTER_NEEDLES = [...Object.keys(TYPE_RENAME_MAP), UNAUTHENTICATED, "createResolver"];

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

function isMemberExpressionObject(node: SgNode): boolean {
  const parent = node.parent();
  if (!parent || parent.kind() !== "member_expression") return false;
  const obj = parent.field("object");
  if (!obj) return false;
  const r = node.range();
  const or = obj.range();
  return r.start.index === or.start.index && r.end.index === or.end.index;
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
      const finalLocal = aliasNode?.text() ?? renamed;
      if (seenLocal.has(finalLocal)) continue;
      // Cross-statement dedupe for non-aliased renames so a file with
      // `import { TailorUser } from "@tailor-platform/sdk"` and
      // `import { TailorActor } from "@tailor-platform/sdk"` does not collapse to
      // two duplicate `import { TailorPrincipal } ...` lines.
      if (!aliasNode && globalEmittedRenamed.has(renamed)) continue;
      seenLocal.add(finalLocal);
      if (!aliasNode) globalEmittedRenamed.add(renamed);
      const asPart = aliasNode ? ` as ${aliasNode.text()}` : "";
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
  const decls = body.findAll({
    rule: {
      kind: "identifier",
      regex: "^caller$",
      inside: { kind: "variable_declarator" },
    },
  });
  if (decls.length > 0) return true;
  const shortDecls = body.findAll({
    rule: {
      kind: "shorthand_property_identifier_pattern",
      regex: "^caller$",
      inside: { kind: "variable_declarator" },
    },
  });
  if (shortDecls.length > 0) return true;
  for (const k of NESTED_FN_KINDS) {
    const fns = body.findAll({ rule: { kind: k } });
    for (const fn of fns) {
      if (functionRebindsName(fn, "caller")) return true;
    }
  }
  return false;
}

function transformResolverBody(arrowNode: SgNode, edits: Edit[]): void {
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
    if (hasCallerBindingConflict(pattern, body)) return;

    let renamedShorthandUser = false;
    // Only iterate top-level pattern children so nested destructures like
    // `({ input: { user } })` are not mistaken for the resolver context user.
    for (const child of pattern.children()) {
      const kind = child.kind();
      if (kind === "shorthand_property_identifier_pattern" && child.text() === "user") {
        edits.push(child.replace("caller"));
        renamedShorthandUser = true;
      } else if (kind === "pair_pattern") {
        const key = child.field("key");
        if (key && key.text() === "user") {
          edits.push(key.replace("caller"));
        }
      } else if (kind === "object_assignment_pattern") {
        // `{ user = fallback }` — the inner shorthand is the binding; default
        // expression is preserved.
        const inner = child
          .children()
          .find((c: SgNode) => c.kind() === "shorthand_property_identifier_pattern");
        if (inner && inner.text() === "user") {
          edits.push(inner.replace("caller"));
          renamedShorthandUser = true;
        }
      }
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
        edits.push(ref.replace("caller"));
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
        edits.push(ref.replace("user: caller"));
      }
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
    edits.push(propId.replace("caller"));
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
  for (const decl of ctxDestructures) {
    const pos = decl.range().start.index;
    if (isInsideAnyRange(pos, ctxShadowRanges)) continue;
    const pat = decl.field("name");
    if (!pat || pat.kind() !== "object_pattern") continue;
    for (const child of pat.children()) {
      const k = child.kind();
      if (k === "shorthand_property_identifier_pattern" && child.text() === "user") {
        edits.push(child.replace("caller: user"));
      } else if (k === "pair_pattern") {
        const key = child.field("key");
        if (key && key.text() === "user") {
          edits.push(key.replace("caller"));
        }
      }
    }
  }
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
 * - Renames `user` to `caller` for top-level destructured resolver bodies (`{ input, user }`),
 *   handles aliased pairs (`{ user: currentUser }`) by rewriting only the property name, and
 *   rewrites `<ctx>.user` for non-destructured single-param bodies — respecting variable
 *   shadowing in both directions.
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
  for (const importStmt of sdkImports) {
    for (const { importedName, aliasNode } of iterateImportSpecs(importStmt)) {
      if (TYPE_RENAME_MAP[importedName] && !aliasNode) {
        sdkRenameSourceNames.add(importedName);
      }
    }
  }

  const typeIdents = tree.findAll({
    rule: {
      kind: "type_identifier",
      not: { inside: { kind: "import_statement" } },
    },
  });
  for (const id of typeIdents) {
    if (!sdkRenameSourceNames.has(id.text())) continue;
    const newName = TYPE_RENAME_MAP[id.text()]!;
    edits.push(id.replace(newName));
  }

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
  for (const importStmt of sdkImports) {
    for (const { importedName, localName } of iterateImportSpecs(importStmt)) {
      if (importedName === "createResolver") {
        createResolverLocalNames.add(localName);
      }
    }
  }
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
      if (arrow) transformResolverBody(arrow, edits);
    }
  }

  if (edits.length === 0) return null;
  let result = tree.commitEdits(edits);

  if (importRemoved) {
    result = result.replace(/^[\t ]*\n+/, "").replace(/\n{3,}/g, "\n\n");
  }
  return result;
}
