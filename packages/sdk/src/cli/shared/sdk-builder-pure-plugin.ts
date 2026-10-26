import { parseSync } from "oxc-parser";
import { RolldownMagicString, type Plugin } from "rolldown";
import { getModuleExportName, type ASTNode } from "#/cli/services/workflow/ast-utils";
import { walkBindingAware } from "#/cli/shared/binding-aware-walk";
import type {
  CallExpression,
  Expression,
  PrivateIdentifier,
  Program,
  SpreadElement,
} from "@oxc-project/types";

const SDK_MODULE = "@tailor-platform/sdk";
const PURE_ANNOTATION = "/* @__PURE__ */ ";

const FIELD_FACTORIES = [
  "uuid",
  "string",
  "bool",
  "int",
  "float",
  "decimal",
  "date",
  "datetime",
  "time",
  "enum",
  "object",
];

/** Member paths a builder chain starts with, keyed by the SDK export. */
export const BUILDER_FACTORIES: Readonly<Record<string, ReadonlySet<string>>> = {
  db: new Set([...FIELD_FACTORIES, "table", "fields.timestamps"]),
  t: new Set(FIELD_FACTORIES),
};

/** Field and table builder methods that only return a configured builder. */
export const BUILDER_METHODS: ReadonlySet<string> = new Set([
  "clone",
  "default",
  "description",
  "hooks",
  "index",
  "relation",
  "serial",
  "typeName",
  "unique",
  "validate",
  "vector",
  "features",
  "files",
  "gqlPermission",
  "indexes",
  "omitFields",
  "permission",
  "pickFields",
  "plugin",
]);

interface AnnotatedSource {
  code: string;
  map: string;
}

type ChainSegment = { kind: "member"; name: string } | { kind: "call"; node: CallExpression };

function collectBuilderBindings(program: Program): Map<string, string> {
  const exportsByLocal = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    if (statement.source.value !== SDK_MODULE) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const importedName = getModuleExportName(specifier.imported);
      if (importedName && Object.hasOwn(BUILDER_FACTORIES, importedName)) {
        exportsByLocal.set(specifier.local.name, importedName);
      }
    }
  }
  return exportsByLocal;
}

function chainSegments(call: CallExpression): { root: string; segments: ChainSegment[] } | null {
  const segments: ChainSegment[] = [];
  let node: Expression = call;
  for (;;) {
    if (node.type === "CallExpression" && !node.optional) {
      segments.push({ kind: "call", node });
      node = node.callee;
    } else if (node.type === "MemberExpression" && !node.computed && !node.optional) {
      segments.push({ kind: "member", name: node.property.name });
      node = node.object;
    } else if (node.type === "Identifier") {
      return { root: node.name, segments: segments.toReversed() };
    } else {
      return null;
    }
  }
}

/**
 * Resolve a call to the calls of the SDK builder chain it ends, innermost first.
 * @param call - Outermost call of the candidate chain
 * @param exportsByLocal - SDK builder export each local binding refers to
 * @returns The chain's calls, or null when the call is not an SDK builder chain
 */
function builderChainCalls(
  call: CallExpression,
  exportsByLocal: ReadonlyMap<string, string>,
): CallExpression[] | null {
  const chain = chainSegments(call);
  const exportName = chain && exportsByLocal.get(chain.root);
  if (!chain || !exportName) return null;
  const { segments } = chain;

  let index = 0;
  const factoryPath: string[] = [];
  for (let segment = segments[index]; segment?.kind === "member"; segment = segments[++index]) {
    factoryPath.push(segment.name);
  }
  const factoryCall = segments[index++];
  if (!BUILDER_FACTORIES[exportName]?.has(factoryPath.join(".")) || factoryCall?.kind !== "call") {
    return null;
  }

  const calls = [factoryCall.node];
  while (index < segments.length) {
    const method = segments[index++];
    const methodCall = segments[index++];
    if (method?.kind !== "member" || !BUILDER_METHODS.has(method.name)) return null;
    if (methodCall?.kind !== "call") return null;
    calls.push(methodCall.node);
  }
  return calls;
}

/**
 * Whether an expression has no side effects, counting property reads and
 * implicit conversions (`valueOf`, `toString`, iterators) as free, as rolldown
 * does for values it cannot see into. A `@__PURE__` call skips evaluating its
 * callee, which holds the arguments of every inner call of the chain, so those
 * arguments must pass this check.
 * @param node - Expression to check
 * @param exportsByLocal - SDK builder export each local binding refers to
 * @returns Whether the expression has no side effects
 */
function isSideEffectFree(
  node: Expression | SpreadElement | PrivateIdentifier | null,
  exportsByLocal: ReadonlyMap<string, string>,
): boolean {
  const check = (child: Expression | SpreadElement | PrivateIdentifier | null) =>
    isSideEffectFree(child, exportsByLocal);
  if (!node) return true;
  switch (node.type) {
    case "Literal":
    case "Identifier":
    case "PrivateIdentifier":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    case "TemplateLiteral":
      return node.expressions.every(check);
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return check(node.expression);
    case "SpreadElement":
      return check(node.argument);
    case "UnaryExpression":
      return node.operator !== "delete" && check(node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return check(node.left) && check(node.right);
    case "ConditionalExpression":
      return check(node.test) && check(node.consequent) && check(node.alternate);
    case "MemberExpression":
      return check(node.object) && (!node.computed || check(node.property));
    case "ArrayExpression":
      return node.elements.every(check);
    case "ObjectExpression":
      return node.properties.every((property) =>
        property.type === "SpreadElement"
          ? check(property)
          : (!property.computed || check(property.key as Expression)) && check(property.value),
      );
    case "CallExpression": {
      const calls = builderChainCalls(node, exportsByLocal);
      return calls !== null && calls.every((call) => call.arguments.every(check));
    }
    default:
      return false;
  }
}

function isChainLink(parent: ASTNode | undefined, key: string | undefined): boolean {
  return (
    (parent?.type === "MemberExpression" && key === "object") ||
    (parent?.type === "CallExpression" && key === "callee")
  );
}

/**
 * Mark `db` / `t` builder chains imported from the SDK with `@__PURE__`, so an
 * unused call that receives one can be removed from the bundle.
 * @param code - Module source
 * @param id - Module ID, whose extension selects the parser language
 * @returns Annotated source with its sourcemap, or null when nothing is annotated
 */
export function annotateSdkBuilderCalls(code: string, id: string): AnnotatedSource | null {
  const { program, errors } = parseSync(id, code);
  if (errors.length > 0) return null;
  const exportsByLocal = collectBuilderBindings(program);
  if (exportsByLocal.size === 0) return null;

  const starts: number[] = [];
  walkBindingAware(
    program,
    new Set(exportsByLocal.keys()),
    (node, shadowedNames, parentNode, parentKey) => {
      if (node.type !== "CallExpression" || isChainLink(parentNode, parentKey)) return;
      const visible =
        shadowedNames.size === 0
          ? exportsByLocal
          : new Map([...exportsByLocal].filter(([localName]) => !shadowedNames.has(localName)));
      const calls = builderChainCalls(node as unknown as CallExpression, visible);
      const innerCalls = calls?.slice(0, -1) ?? [];
      if (
        calls &&
        innerCalls.every((call) =>
          call.arguments.every((argument) => isSideEffectFree(argument, visible)),
        )
      ) {
        starts.push(node.start as number);
      }
    },
  );
  if (starts.length === 0) return null;

  const source = new RolldownMagicString(code);
  for (const start of starts) source.appendLeft(start, PURE_ANNOTATION);
  return { code: source.toString(), map: source.generateMap({ hires: "boundary" }).toString() };
}

/** Annotation results shared by the bundles of one CLI run, keyed by module ID. */
export type SdkBuilderAnnotationCache = Map<
  string,
  { code: string; result: AnnotatedSource | null }
>;

/**
 * Create the plugin that marks SDK builder chains in project modules as pure.
 * @param cache - Results to reuse for modules whose code has not changed
 * @returns Rolldown plugin
 */
export function createSdkBuilderPurePlugin(cache: SdkBuilderAnnotationCache = new Map()): Plugin {
  return {
    name: "tailor-sdk-builder-pure",
    transform: {
      filter: {
        id: { include: [/\.[cm]?[jt]sx?$/], exclude: [/[\\/]node_modules[\\/]/] },
        code: { include: [SDK_MODULE] },
      },
      handler(code, id) {
        const cached = cache.get(id);
        if (cached?.code === code) return cached.result;
        const result = annotateSdkBuilderCalls(code, id);
        cache.set(id, { code, result });
        return result;
      },
    },
  };
}
