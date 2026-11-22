import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { walkBindingAware } from "#/cli/shared/binding-aware-walk";
import { withErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import {
  normalizeFilePath,
  type StartContext,
  type StartModuleBindings,
  type StartTarget,
} from "#/cli/shared/start-context";
import {
  createTsconfigLookupCache,
  matchTsconfigPaths,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import {
  type Replacement,
  type StartCallInfo,
  applyReplacements,
  findProperty,
  getModuleExportName,
  getNamespaceStartCallInfo,
  getStartCallInfo,
} from "./ast-utils";
import type { HookFailures } from "#/cli/services/hook-failures";
import type { Program } from "@oxc-project/types";
import type { Plugin, RolldownMagicString } from "rolldown";

export interface ResolvedStartCall extends StartCallInfo {
  kind: "job" | "workflow";
  targetName: string;
}

interface UndetectableImport {
  importSource: string;
  importedName: string;
}

interface NamespaceImport {
  importSource: string;
  module: StartModuleBindings;
}

interface LocalTargets {
  targets: Map<string, StartTarget>;
  undetectableImports: Map<string, UndetectableImport>;
  namespaceImports: Map<string, NamespaceImport>;
}

const START_CALL_RE = /\.start(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(/;

/**
 * Fast pre-check for whether `code` contains a `.start(` call, tolerating
 * whitespace, newlines, and comments between `.start` and `(` that a plain
 * substring check would miss.
 * @param code - Source text to scan
 * @returns Whether `code` contains a `.start(` call
 */
export function hasStartCall(code: string): boolean {
  return START_CALL_RE.test(code);
}

const NORMALIZER_IDENTIFIER = "__tailor_normalizeStartOptions";

const WORKFLOW_RUNTIME_EXPR = "globalThis.tailor.workflow";

/**
 * Build the source text of the injected normalizer helper.
 *
 * Renames an `invoker` in the start options to the `authInvoker` form the
 * platform RPC expects: a plain string (machine user name) becomes
 * `{ namespace, machineUserName }`, while an object form passes through
 * as-is. Any other options value is unchanged. The auth namespace is baked
 * in at bundle time; without one, a string invoker is left unchanged.
 * @param authNamespace - Auth service namespace to embed
 * @returns Source line defining the helper
 */
function buildNormalizerHelperSource(authNamespace: string | undefined): string {
  const fromString =
    authNamespace === undefined
      ? "o"
      : `{ ...rest, authInvoker: { namespace: ${JSON.stringify(authNamespace)}, machineUserName: invoker } }`;
  return `const ${NORMALIZER_IDENTIFIER} = (o) => { if (!o) return o; const { invoker, ...rest } = o; return typeof invoker === "string" ? ${fromString} : typeof invoker === "object" ? { ...rest, authInvoker: invoker } : o; };\n`;
}

function findModule(context: StartContext, candidatePath: string): StartModuleBindings | undefined {
  const modulePath = normalizeFilePath(candidatePath);
  return context.modules.get(modulePath) ?? context.modules.get(path.join(modulePath, "index"));
}

function resolveImport(
  context: StartContext,
  currentFilePath: string,
  importSource: string,
  tsconfigCache: TsconfigLookupCache,
): StartModuleBindings | undefined {
  const currentDirectory = path.dirname(currentFilePath.replace(/[?#].*$/, ""));
  if (importSource.startsWith(".")) {
    return findModule(context, path.resolve(currentDirectory, importSource));
  }
  for (const candidate of matchTsconfigPaths(importSource, currentDirectory, tsconfigCache)) {
    const found = findModule(context, candidate);
    if (found) return found;
  }
  return undefined;
}

function collectLocalTargets(
  program: Program,
  context: StartContext,
  currentFilePath: string,
): LocalTargets {
  const targets = new Map<string, StartTarget>();
  const undetectableImports = new Map<string, UndetectableImport>();
  const namespaceImports = new Map<string, NamespaceImport>();
  const currentModule = context.modules.get(normalizeFilePath(currentFilePath));
  if (currentModule) {
    for (const [localName, target] of currentModule.localBindings) {
      targets.set(localName, target);
    }
  }

  const tsconfigCache = context.tsconfigCache ?? createTsconfigLookupCache();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const importSource = statement.source.value;
    if (typeof importSource !== "string") continue;
    const importedModule = resolveImport(context, currentFilePath, importSource, tsconfigCache);
    if (!importedModule) continue;

    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaceImports.set(specifier.local.name, { importSource, module: importedModule });
        continue;
      }
      if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;

      const importedName =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : getModuleExportName(specifier.imported);
      if (!importedName) continue;
      const target = importedModule.exports.get(importedName);
      if (!target) {
        undetectableImports.set(specifier.local.name, { importSource, importedName });
        continue;
      }
      targets.set(specifier.local.name, target);
    }
  }

  return { targets, undetectableImports, namespaceImports };
}

function undetectableStartCallError(
  calleeText: string,
  currentFilePath: string,
  { importSource, importedName }: UndetectableImport,
): Error {
  const exportLabel = importedName === "default" ? "default export" : `export "${importedName}"`;
  return withErrorDiagnostics(
    CLIError({
      code: "WORKFLOW_START_TARGET_UNDETECTABLE",
      message:
        `${calleeText}() cannot be rewritten: "${importSource}" is a workflow file, but its ` +
        `${exportLabel} is not a workflow or job the build can detect.`,
      details:
        `The build rewrites .start() on the file's default-exported workflow (including one ` +
        `returned from a helper function) and on workflows and jobs created in that file with ` +
        `createWorkflow({ name: "..." }) or createWorkflowJob({ name: "...", body }) using a ` +
        `literal name; any other .start() would fail at runtime after deploy.`,
      context: { file: currentFilePath, callee: calleeText, importSource, importedName },
    }),
    { location: { file: currentFilePath } },
  );
}

function assertNoUndetectableStartCalls(
  program: Program,
  sourceText: string,
  { undetectableImports, namespaceImports }: LocalTargets,
  currentFilePath: string,
): void {
  const names = new Set([...undetectableImports.keys(), ...namespaceImports.keys()]);
  walkBindingAware(program, names, (node, shadowedNames) => {
    const namespaceCall = getNamespaceStartCallInfo(node, sourceText);
    if (namespaceCall && !shadowedNames.has(namespaceCall.identifierName)) {
      const namespaceImport = namespaceImports.get(namespaceCall.identifierName);
      if (namespaceImport && !namespaceImport.module.exports.has(namespaceCall.memberName)) {
        throw undetectableStartCallError(namespaceCall.calleeText, currentFilePath, {
          importSource: namespaceImport.importSource,
          importedName: namespaceCall.memberName,
        });
      }
    }

    const startCall = getStartCallInfo(node);
    if (!startCall || shadowedNames.has(startCall.identifierName)) return;
    const undetectable = undetectableImports.get(startCall.identifierName);
    if (!undetectable) return;
    throw undetectableStartCallError(
      `${startCall.identifierName}.start`,
      currentFilePath,
      undetectable,
    );
  });
}

function detectStartCallsWithTargets(
  program: Program,
  sourceText: string,
  { targets, namespaceImports }: LocalTargets,
): ResolvedStartCall[] {
  const calls: ResolvedStartCall[] = [];
  const targetNames = new Set([...targets.keys(), ...namespaceImports.keys()]);

  walkBindingAware(program, targetNames, (node, shadowedNames) => {
    const namespaceCall = getNamespaceStartCallInfo(node, sourceText);
    if (namespaceCall && !shadowedNames.has(namespaceCall.identifierName)) {
      const target = namespaceImports
        .get(namespaceCall.identifierName)
        ?.module.exports.get(namespaceCall.memberName);
      if (target) {
        const { memberName: _memberName, calleeText: _calleeText, ...startCall } = namespaceCall;
        calls.push({ ...startCall, kind: target.kind, targetName: target.name });
      }
      return;
    }

    const startCall = getStartCallInfo(node);
    if (!startCall || shadowedNames.has(startCall.identifierName)) return;
    const target = targets.get(startCall.identifierName);
    if (target) {
      calls.push({ ...startCall, kind: target.kind, targetName: target.name });
    }
  });

  return calls;
}

export function detectResolvedStartCalls(
  program: Program,
  sourceText: string,
  context: StartContext,
  currentFilePath: string,
): ResolvedStartCall[] {
  return detectStartCallsWithTargets(
    program,
    sourceText,
    collectLocalTargets(program, context, currentFilePath),
  );
}

export function transformStartCalls(
  source: string,
  startContext: StartContext,
  currentFilePath: string,
): RolldownMagicString {
  const { program } = parseSync("input.ts", source);
  const localTargets = collectLocalTargets(program, startContext, currentFilePath);
  assertNoUndetectableStartCalls(program, source, localTargets, currentFilePath);
  const { authNamespace, jobFunctionName } = startContext;
  const allStartCalls = detectStartCallsWithTargets(program, source, localTargets);
  const nestedStartCalls: Array<{ call: ResolvedStartCall; parent: ResolvedStartCall }> = [];
  const startCalls = allStartCalls.filter((call) => {
    const parent = allStartCalls.find(
      (other) =>
        other !== call &&
        other.callRange.start <= call.callRange.start &&
        call.callRange.end <= other.callRange.end,
    );
    if (!parent) return true;
    nestedStartCalls.push({ call, parent });
    return false;
  });

  for (const { call, parent } of nestedStartCalls) {
    logger.warn(
      `Nested start call "${call.identifierName}.start(...)" inside "${parent.identifierName}.start(...)" cannot be converted. Move it to a separate statement and pass the result instead.`,
    );
  }

  const replacements: Replacement[] = [];
  // Whether any workflow start invoker was wrapped with the runtime
  // normalizer. Used to decide whether to inject the helper at the top.
  let needsNormalizerHelper = false;

  for (const call of startCalls) {
    const method = call.kind === "workflow" ? "startWorkflow" : "execJobFunction";
    const target =
      call.kind === "job" && jobFunctionName ? jobFunctionName(call.targetName) : call.targetName;
    const prefix = `${WORKFLOW_RUNTIME_EXPR}.${method}(${JSON.stringify(target)}, `;
    const { argsRange, optionsRange, callRange } = call;
    if (!argsRange) {
      replacements.push({ ...callRange, text: `${prefix}undefined)` });
      continue;
    }
    replacements.push({
      start: callRange.start,
      end: argsRange.start,
      text: prefix,
    });
    const normalizeOptions = call.kind === "workflow" && optionsRange;
    if (normalizeOptions && authNamespace === undefined) {
      const invoker = resolveStartInvoker({
        call,
        currentFilePath,
        machineUserAuthNamespaces: startContext.machineUserAuthNamespaces,
      });
      if (invoker) replacements.push(invoker);
    }
    if (optionsRange) {
      replacements.push({
        start: argsRange.end,
        end: optionsRange.start,
        text: normalizeOptions ? `, ${NORMALIZER_IDENTIFIER}(` : ", ",
      });
    }
    replacements.push({
      start: optionsRange?.end ?? argsRange.end,
      end: callRange.end,
      text: normalizeOptions ? "))" : ")",
    });
    if (normalizeOptions) needsNormalizerHelper = true;
  }

  const transformed = applyReplacements(source, replacements);
  if (needsNormalizerHelper) {
    transformed.prepend(buildNormalizerHelperSource(authNamespace));
  }
  return transformed;
}

type StartInvokerErrorCode =
  | "WORKFLOW_START_INVOKER_AMBIGUOUS"
  | "WORKFLOW_START_INVOKER_AUTH_REQUIRED"
  | "WORKFLOW_START_INVOKER_NOT_FOUND"
  | "WORKFLOW_START_INVOKER_UNRESOLVED";

type StartInvokerErrorParams = {
  call: ResolvedStartCall;
  currentFilePath: string;
  code: StartInvokerErrorCode;
  message: string;
  suggestion: string;
};

function startInvokerError(params: StartInvokerErrorParams): Error {
  const { call, currentFilePath, code, message, suggestion } = params;
  return withErrorDiagnostics(
    CLIError({
      code,
      message: `${call.identifierName}.start() ${message}`,
      suggestion,
      context: { file: currentFilePath, workflow: call.targetName },
    }),
    { location: { file: currentFilePath } },
  );
}

const NAMED_AUTH_INVOKER =
  '{ invoker: { namespace: "<auth>", machineUserName: "<machine user>" } }';

type StartOptionsNode = NonNullable<ResolvedStartCall["options"]>;

/**
 * Strip the wrappers that do not change a value: parentheses and TypeScript-only assertions.
 * @param node - Expression as written
 * @returns The wrapped expression
 */
function unwrapExpression(node: StartOptionsNode): StartOptionsNode {
  let current = node;
  for (;;) {
    switch (current.type) {
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
        current = current.expression;
        break;
      default:
        return current;
    }
  }
}

function staticString(node: StartOptionsNode): string | undefined {
  const value = unwrapExpression(node);
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

type ResolveStartInvokerParams = {
  call: ResolvedStartCall;
  currentFilePath: string;
  /** Auth namespaces that define each machine user; undefined for a config without an Auth service. */
  machineUserAuthNamespaces: ReadonlyMap<string, readonly string[]> | undefined;
};

/**
 * Resolve the string-literal invoker of a workflow start in a config without exactly one Auth
 * service, whose runtime cannot tell which Auth service a machine user name belongs to.
 * @param params - The start call, its file, and the Auth namespaces that define each machine user
 * @returns The rewrite of a string-literal invoker into the form that names its Auth service, or undefined when the call needs none
 */
function resolveStartInvoker(params: ResolveStartInvokerParams): Replacement | undefined {
  const { call, currentFilePath, machineUserAuthNamespaces } = params;
  const fail = (code: StartInvokerErrorCode, message: string, suggestion: string) =>
    startInvokerError({ call, currentFilePath, code, message, suggestion });
  const unresolvedReason = machineUserAuthNamespaces
    ? "so the build cannot tell which Auth service the invoker belongs to"
    : "and the config has no Auth service, so the build cannot tell whether the invoker names one";
  if (!call.options) return undefined;
  const options = unwrapExpression(call.options);
  if (options.type === "Identifier" && options.name === "undefined") return undefined;
  if (options.type !== "ObjectExpression") {
    throw fail(
      "WORKFLOW_START_INVOKER_UNRESOLVED",
      `passes options the build cannot read, ${unresolvedReason}.`,
      "Pass the options as an object literal.",
    );
  }
  const invoker = findProperty(options.properties, "invoker");
  if (!invoker && options.properties.some((property) => property.type !== "Property")) {
    throw fail(
      "WORKFLOW_START_INVOKER_UNRESOLVED",
      `spreads its options, ${unresolvedReason}.`,
      "Write the invoker in the options object literal.",
    );
  }
  if (!invoker || unwrapExpression(invoker.value).type === "ObjectExpression") return undefined;
  const machineUserName = staticString(invoker.value);
  if (machineUserName === undefined) {
    throw fail(
      "WORKFLOW_START_INVOKER_UNRESOLVED",
      `passes an invoker the build cannot read, and the config has ${machineUserAuthNamespaces ? "several Auth services" : "no Auth service"}.`,
      machineUserAuthNamespaces
        ? `Pass the invoker as a string literal, or name its Auth service with ${NAMED_AUTH_INVOKER}.`
        : `Name its Auth service with ${NAMED_AUTH_INVOKER}.`,
    );
  }
  if (!machineUserAuthNamespaces) {
    throw fail(
      "WORKFLOW_START_INVOKER_AUTH_REQUIRED",
      `runs as "${machineUserName}", but the config has no Auth service.`,
      `Name the Auth service that defines the machine user: { invoker: { namespace: "<auth>", machineUserName: "${machineUserName}" } }, or configure an Auth service.`,
    );
  }
  const namespaces = machineUserAuthNamespaces.get(machineUserName) ?? [];
  const [namespace, ...others] = namespaces;
  if (namespace === undefined) {
    throw fail(
      "WORKFLOW_START_INVOKER_NOT_FOUND",
      `runs as "${machineUserName}", which no Auth service of the config defines.`,
      "Define the machine user in one of the config's Auth services, or name an existing one.",
    );
  }
  if (others.length > 0) {
    throw fail(
      "WORKFLOW_START_INVOKER_AMBIGUOUS",
      `runs as "${machineUserName}", which the Auth services ${namespaces.join(", ")} all define.`,
      `Name the Auth service: { invoker: { namespace: "${namespace}", machineUserName: "${machineUserName}" } }.`,
    );
  }
  return {
    start: invoker.value.start,
    end: invoker.value.end,
    text: `{ namespace: ${JSON.stringify(namespace)}, machineUserName: ${JSON.stringify(machineUserName)} }`,
  };
}

export function createStartTransformPlugin(
  startContext: StartContext | undefined,
  hookFailures: HookFailures,
): Plugin | undefined {
  if (!startContext || startContext.modules.size === 0) return undefined;

  return {
    name: "start-transform",
    transform: {
      filter: { id: { include: [/\.(ts|mts|cts|js|mjs|cjs)$/] } },
      handler(code, id) {
        if (!hasStartCall(code)) return null;
        return hookFailures.capture(() => {
          const transformed = transformStartCalls(code, startContext, id);
          return {
            code: transformed.toString(),
            map: transformed.generateMap({ hires: "boundary" }).toString(),
          };
        }, null);
      },
    },
  };
}
