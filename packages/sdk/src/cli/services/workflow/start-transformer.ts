import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { walkBindingAware } from "#/cli/shared/binding-aware-walk";
import { locatedCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import {
  createModuleBindings,
  normalizeFilePath,
  parseStartModule,
  safeRealpath,
  SOURCE_EXTENSIONS,
  SOURCE_FILE_PATTERN,
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
  /** The callee as written, such as `orderWorkflow.start` or `wf.default.start`. */
  calleeText: string;
}

interface UndetectableImport {
  importSource: string;
  importedName: string;
}

interface NamespaceImport {
  importSource: string;
  module: StartModuleBindings;
}

interface UnlistedImport {
  importSource: string;
  /** Imported export name; absent for a namespace import. */
  importedName?: string | undefined;
  /** Paths the import source may resolve to before an extension or `/index` is added. */
  candidates: string[];
}

interface LocalTargets {
  targets: Map<string, StartTarget>;
  undetectableImports: Map<string, UndetectableImport>;
  namespaceImports: Map<string, NamespaceImport>;
  unlistedImports: Map<string, UnlistedImport>;
  /** Workflows and jobs the current file defines, when it is not a workflow file. */
  unlistedLocals: Map<string, StartTarget>;
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

function importCandidates(
  currentFilePath: string,
  importSource: string,
  tsconfigCache: TsconfigLookupCache,
): string[] {
  const currentDirectory = path.dirname(currentFilePath.replace(/[?#].*$/, ""));
  if (importSource.startsWith(".")) return [path.resolve(currentDirectory, importSource)];
  return matchTsconfigPaths(importSource, currentDirectory, tsconfigCache);
}

function findSourceFile(candidate: string): string | undefined {
  const base = normalizeFilePath(candidate);
  for (const file of [
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]) {
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
  }
  return undefined;
}

function isListedFile(context: StartContext, file: string): boolean {
  const realFile = normalizeFilePath(safeRealpath(file));
  return [...context.modules.values()].some(
    (module) => normalizeFilePath(safeRealpath(module.sourceFile)) === realFile,
  );
}

function readStartModule(file: string): StartModuleBindings | null {
  try {
    return parseStartModule(file, fs.readFileSync(file, "utf-8")).bindings ?? null;
  } catch {
    return null;
  }
}

function readUnlistedModule(context: StartContext, file: string): StartModuleBindings | null {
  const cached = context.unlistedModules?.get(file);
  if (cached !== undefined) return cached;
  const bindings = isListedFile(context, file) ? null : readStartModule(file);
  context.unlistedModules?.set(file, bindings);
  return bindings;
}

function resolveUnlistedTarget(
  context: StartContext,
  unlisted: UnlistedImport,
  exportName: string,
): { target: StartTarget; targetFile: string } | undefined {
  for (const candidate of unlisted.candidates) {
    const file = findSourceFile(candidate);
    if (!file) continue;
    const target = readUnlistedModule(context, file)?.exports.get(exportName);
    return target && { target, targetFile: file };
  }
  return undefined;
}

function collectLocalTargets(
  program: Program,
  sourceText: string,
  context: StartContext,
  currentFilePath: string,
): LocalTargets {
  const currentModule = context.modules.get(normalizeFilePath(currentFilePath));
  const targets = new Map(currentModule?.localBindings);
  const unlistedLocals = currentModule
    ? new Map<string, StartTarget>()
    : createModuleBindings(currentFilePath, program, sourceText).localBindings;
  const undetectableImports = new Map<string, UndetectableImport>();
  const namespaceImports = new Map<string, NamespaceImport>();
  const unlistedImports = new Map<string, UnlistedImport>();

  const tsconfigCache = context.tsconfigCache ?? createTsconfigLookupCache();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const importSource = statement.source.value;
    if (typeof importSource !== "string") continue;
    const candidates = importCandidates(currentFilePath, importSource, tsconfigCache);
    const importedModule = candidates
      .map((candidate) => findModule(context, candidate))
      .find((module) => module !== undefined);

    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
      const localName = specifier.local.name;
      if (specifier.type === "ImportNamespaceSpecifier") {
        if (importedModule)
          namespaceImports.set(localName, { importSource, module: importedModule });
        else unlistedImports.set(localName, { importSource, candidates });
        continue;
      }

      const importedName =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : getModuleExportName(specifier.imported);
      if (!importedName) continue;
      if (!importedModule) {
        unlistedImports.set(localName, { importSource, importedName, candidates });
        continue;
      }
      const target = importedModule.exports.get(importedName);
      if (target) targets.set(localName, target);
      else undetectableImports.set(localName, { importSource, importedName });
    }
  }

  return { targets, undetectableImports, namespaceImports, unlistedImports, unlistedLocals };
}

function undetectableStartCallError(
  calleeText: string,
  currentFilePath: string,
  { importSource, importedName }: UndetectableImport,
): Error {
  const exportLabel = importedName === "default" ? "default export" : `export "${importedName}"`;
  return locatedCLIError(
    { file: currentFilePath },
    {
      code: "WORKFLOW_START_TARGET_UNDETECTABLE",
      message:
        `${calleeText}() cannot be rewritten: "${importSource}" is a workflow file, but its ` +
        `${exportLabel} is not a workflow or job the build can detect.`,
      details:
        `The build rewrites .start() on the file's default-exported workflow (including one ` +
        `returned from a helper function) and on workflows and jobs created in that file with ` +
        `createWorkflow({ name: "..." }) or createWorkflowJob({ name: "...", body }) using a ` +
        `literal name; any other .start() would fail at runtime after deploy.`,
      context: { callee: calleeText, importSource, importedName },
    },
  );
}

interface OutsideFilesStartCall {
  calleeText: string;
  currentFilePath: string;
  /** Import the call reaches its target through; absent for a target the calling file defines. */
  importSource?: string | undefined;
  importedName?: string | undefined;
  target: StartTarget;
  targetFile: string;
}

function startTargetOutsideFilesError(call: OutsideFilesStartCall, baseDir = process.cwd()): Error {
  const { calleeText, currentFilePath, importSource, importedName, target, targetFile } = call;
  const displayFile = path.relative(process.cwd(), targetFile);
  const filesEntry = path.relative(baseDir, targetFile);
  return locatedCLIError(
    { file: currentFilePath },
    {
      code: "WORKFLOW_START_TARGET_OUTSIDE_FILES",
      message:
        `${calleeText}() cannot be rewritten: ${target.kind} "${target.name}" is defined in ` +
        `${displayFile}, which the config's workflow "files" do not include.`,
      suggestion:
        `Add ${filesEntry} to the workflow "files" in the config (add a workflow service if it ` +
        `has none), or remove the "!" pattern or "ignores" entry that leaves it out.`,
      context: {
        callee: calleeText,
        importSource,
        importedName,
        kind: target.kind,
        targetName: target.name,
        targetFile,
      },
    },
  );
}

function assertRewritableStartCalls(
  program: Program,
  sourceText: string,
  localTargets: LocalTargets,
  context: StartContext,
  currentFilePath: string,
): void {
  const { undetectableImports, namespaceImports, unlistedImports, unlistedLocals } = localTargets;
  const names = new Set([
    ...undetectableImports.keys(),
    ...namespaceImports.keys(),
    ...unlistedImports.keys(),
    ...unlistedLocals.keys(),
  ]);
  const assertImportNotOutsideFiles = (
    calleeText: string,
    unlisted: UnlistedImport,
    importedName: string,
  ) => {
    const resolved = resolveUnlistedTarget(context, unlisted, importedName);
    if (!resolved) return;
    throw startTargetOutsideFilesError(
      {
        calleeText,
        currentFilePath,
        importSource: unlisted.importSource,
        importedName,
        ...resolved,
      },
      context.baseDir,
    );
  };
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
      const unlisted = unlistedImports.get(namespaceCall.identifierName);
      if (unlisted && unlisted.importedName === undefined) {
        assertImportNotOutsideFiles(namespaceCall.calleeText, unlisted, namespaceCall.memberName);
      }
    }

    const startCall = getStartCallInfo(node);
    if (!startCall || shadowedNames.has(startCall.identifierName)) return;
    const calleeText = `${startCall.identifierName}.start`;
    const unlisted = unlistedImports.get(startCall.identifierName);
    if (unlisted?.importedName !== undefined) {
      assertImportNotOutsideFiles(calleeText, unlisted, unlisted.importedName);
    }
    const local = unlistedLocals.get(startCall.identifierName);
    if (local && !isListedFile(context, currentFilePath)) {
      throw startTargetOutsideFilesError(
        {
          calleeText,
          currentFilePath,
          target: local,
          targetFile: currentFilePath.replace(/[?#].*$/, ""),
        },
        context.baseDir,
      );
    }
    const undetectable = undetectableImports.get(startCall.identifierName);
    if (!undetectable) return;
    throw undetectableStartCallError(calleeText, currentFilePath, undetectable);
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
        const { memberName: _memberName, ...startCall } = namespaceCall;
        calls.push({ ...startCall, kind: target.kind, targetName: target.name });
      }
      return;
    }

    const startCall = getStartCallInfo(node);
    if (!startCall || shadowedNames.has(startCall.identifierName)) return;
    const target = targets.get(startCall.identifierName);
    if (target) {
      calls.push({
        ...startCall,
        kind: target.kind,
        targetName: target.name,
        calleeText: `${startCall.identifierName}.start`,
      });
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
    collectLocalTargets(program, sourceText, context, currentFilePath),
  );
}

export function transformStartCalls(
  source: string,
  startContext: StartContext,
  currentFilePath: string,
): RolldownMagicString {
  const { program } = parseSync("input.ts", source);
  const localTargets = collectLocalTargets(program, source, startContext, currentFilePath);
  assertRewritableStartCalls(program, source, localTargets, startContext, currentFilePath);
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
  return locatedCLIError(
    { file: currentFilePath },
    {
      code,
      message: `${call.calleeText}() ${message}`,
      suggestion,
      context: { workflow: call.targetName },
    },
  );
}

function namedAuthInvoker(namespace = "<auth>", machineUserName = "<machine user>"): string {
  return `{ invoker: { namespace: ${JSON.stringify(namespace)}, machineUserName: ${JSON.stringify(machineUserName)} } }`;
}

type UnreadableStartPart = "options" | "spread" | "invoker";

const UNRESOLVED_INVOKER = {
  options: {
    message:
      "passes options the build cannot read, so the build cannot tell which Auth service the invoker belongs to.",
    suggestion: "Pass the options as an object literal.",
  },
  spread: {
    message:
      "spreads its options, so the build cannot tell which Auth service the invoker belongs to.",
    suggestion: "Write the invoker in the options object literal.",
  },
  invoker: {
    message: "passes an invoker the build cannot read, and the config has several Auth services.",
    suggestion: `Pass the invoker as a string literal, or name its Auth service with ${namedAuthInvoker()}.`,
  },
} satisfies Record<UnreadableStartPart, { message: string; suggestion: string }>;

type StartOptionsNode = NonNullable<ResolvedStartCall["options"]>;

type StartInvoker =
  | { kind: "string"; node: StartOptionsNode; machineUserName: string }
  | { kind: "unreadable"; part: UnreadableStartPart };

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

function isUndefined(node: StartOptionsNode): boolean {
  const value = unwrapExpression(node);
  return value.type === "Identifier" && value.name === "undefined";
}

/**
 * Read the invoker in the options of a workflow start.
 * @param options - The options argument as written
 * @returns A string-literal invoker or the part the build cannot read, or undefined when the start passes no invoker, `undefined`, or an object literal invoker
 */
function readStartInvoker(options: StartOptionsNode | undefined): StartInvoker | undefined {
  if (!options || isUndefined(options)) return undefined;
  const value = unwrapExpression(options);
  if (value.type !== "ObjectExpression") return { kind: "unreadable", part: "options" };
  const invoker = findProperty(value.properties, "invoker");
  if (!invoker) {
    return value.properties.some((property) => property.type !== "Property")
      ? { kind: "unreadable", part: "spread" }
      : undefined;
  }
  if (isUndefined(invoker.value) || unwrapExpression(invoker.value).type === "ObjectExpression") {
    return undefined;
  }
  const machineUserName = staticString(invoker.value);
  return machineUserName === undefined
    ? { kind: "unreadable", part: "invoker" }
    : { kind: "string", node: invoker.value, machineUserName };
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
  const invoker = readStartInvoker(call.options);
  if (!invoker || (invoker.kind === "unreadable" && !machineUserAuthNamespaces)) return undefined;
  if (invoker.kind === "unreadable") {
    const { message, suggestion } = UNRESOLVED_INVOKER[invoker.part];
    throw fail("WORKFLOW_START_INVOKER_UNRESOLVED", message, suggestion);
  }
  const { node, machineUserName } = invoker;
  if (!machineUserAuthNamespaces) {
    throw fail(
      "WORKFLOW_START_INVOKER_AUTH_REQUIRED",
      `runs as "${machineUserName}", but the config has no Auth service.`,
      `Name the Auth service that defines the machine user: ${namedAuthInvoker(undefined, machineUserName)}, or configure an Auth service.`,
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
      `Name the Auth service: ${namedAuthInvoker(namespace, machineUserName)}.`,
    );
  }
  return {
    start: node.start,
    end: node.end,
    text: `{ namespace: ${JSON.stringify(namespace)}, machineUserName: ${JSON.stringify(machineUserName)} }`,
  };
}

export function createStartTransformPlugin(
  startContext: StartContext | undefined,
  hookFailures: HookFailures,
): Plugin | undefined {
  if (!startContext) return undefined;

  return {
    name: "start-transform",
    transform: {
      filter: { id: { include: [SOURCE_FILE_PATTERN] } },
      handler(code, id) {
        if (!hasStartCall(code)) return null;
        return hookFailures.capture(() => {
          const transformed = transformStartCalls(code, startContext, id);
          if (!transformed.hasChanged()) return null;
          return {
            code: transformed.toString(),
            map: transformed.generateMap({ hires: "boundary" }).toString(),
          };
        }, null);
      },
    },
  };
}
