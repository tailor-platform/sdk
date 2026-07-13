import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { logger } from "#/cli/shared/logger";
import {
  normalizeFilePath,
  type TriggerContext,
  type TriggerModuleBindings,
  type TriggerTarget,
} from "#/cli/shared/trigger-context";
import {
  type ASTNode,
  type Replacement,
  type TriggerCallInfo,
  applyReplacements,
  getModuleExportName,
  getTriggerCallInfo,
} from "./ast-utils";
import type { Program } from "@oxc-project/types";
import type { Plugin } from "rolldown";

export interface ResolvedTriggerCall extends TriggerCallInfo {
  kind: "job" | "workflow";
  targetName: string;
}

const NORMALIZER_IDENTIFIER = "__tailor_normalizeTriggerOptions";

/**
 * Build the source text of the injected normalizer helper.
 *
 * Renames an `invoker` in the trigger options to the `authInvoker` form the
 * platform RPC expects: a plain string (machine user name) becomes
 * `{ namespace, machineUserName }`, while an object form passes through
 * as-is. Any other options value is unchanged. The auth namespace is baked
 * in at bundle time.
 * @param authNamespace - Auth service namespace to embed
 * @returns Source line defining the helper
 */
function buildNormalizerHelperSource(authNamespace: string): string {
  return `const ${NORMALIZER_IDENTIFIER} = (o) => { if (!o) return o; const { invoker, ...rest } = o; return typeof invoker === "string" ? { ...rest, authInvoker: { namespace: ${JSON.stringify(authNamespace)}, machineUserName: invoker } } : typeof invoker === "object" ? { ...rest, authInvoker: invoker } : o; };\n`;
}

function collectBindingNames(node: ASTNode | null | undefined, names: Set<string>): void {
  if (!node || typeof node !== "object") return;

  switch (node.type) {
    case "Identifier":
      names.add(node.name as string);
      return;
    case "ObjectPattern":
      for (const property of node.properties as ASTNode[]) {
        collectBindingNames(
          property.type === "RestElement"
            ? (property.argument as ASTNode)
            : (property.value as ASTNode),
          names,
        );
      }
      return;
    case "ArrayPattern":
      for (const element of node.elements as Array<ASTNode | null>) {
        collectBindingNames(element, names);
      }
      return;
    case "AssignmentPattern":
      collectBindingNames(node.left as ASTNode, names);
      return;
    case "RestElement":
      collectBindingNames(node.argument as ASTNode, names);
      return;
    case "TSParameterProperty":
      collectBindingNames(node.parameter as ASTNode, names);
  }
}

function declarationNode(statement: ASTNode): ASTNode | undefined {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration as ASTNode | undefined)
    : statement;
}

function collectBlockBindings(statements: ASTNode[], names: Set<string>): void {
  for (const statement of statements) {
    const declaration = declarationNode(statement);
    if (!declaration) continue;

    if (declaration.type === "VariableDeclaration") {
      if (declaration.kind === "var") continue;
      for (const declarator of declaration.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
    } else if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration"
    ) {
      collectBindingNames(declaration.id as ASTNode | undefined, names);
    }
  }
}

function collectFunctionVarBindings(root: ASTNode, names: Set<string>): void {
  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;
    if (
      node !== root &&
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression" ||
        node.type === "StaticBlock")
    ) {
      return;
    }
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const declarator of node.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        for (const item of child) walk(item as ASTNode | null);
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(root);
}

function collectScopeBindings(node: ASTNode): Set<string> | undefined {
  const names = new Set<string>();

  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    collectBindingNames(node.id as ASTNode | undefined, names);
    for (const parameter of node.params as ASTNode[]) {
      collectBindingNames(parameter, names);
    }
    collectFunctionVarBindings(node, names);
    return names;
  }

  if (node.type === "BlockStatement") {
    collectBlockBindings(node.body as ASTNode[], names);
    return names;
  }

  if (node.type === "CatchClause") {
    collectBindingNames(node.param as ASTNode | undefined, names);
    return names;
  }

  if (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const declaration = (node.init ?? node.left) as ASTNode | undefined;
    if (declaration?.type === "VariableDeclaration" && declaration.kind !== "var") {
      for (const declarator of declaration.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
    }
    return names;
  }

  return undefined;
}

function addShadowedBindings(
  shadowedNames: ReadonlySet<string>,
  bindings: Set<string> | undefined,
  targetNames: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!bindings) return shadowedNames;
  const relevantBindings = [...bindings].filter((name) => targetNames.has(name));
  return relevantBindings.length === 0
    ? shadowedNames
    : new Set([...shadowedNames, ...relevantBindings]);
}

function walkBindingAware(
  program: Program,
  targetNames: ReadonlySet<string>,
  visitor: (
    node: ASTNode,
    shadowedNames: ReadonlySet<string>,
    parentNode?: ASTNode,
    parentKey?: string,
  ) => void,
): void {
  function walk(
    node: ASTNode | null | undefined,
    shadowedNames: ReadonlySet<string>,
    parentNode?: ASTNode,
    parentKey?: string,
  ): void {
    if (!node || typeof node !== "object" || node.type === "ImportDeclaration") return;

    const nestedShadowedNames =
      node.type === "Program"
        ? shadowedNames
        : addShadowedBindings(shadowedNames, collectScopeBindings(node), targetNames);
    visitor(node, nestedShadowedNames, parentNode, parentKey);

    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item as ASTNode | null, nestedShadowedNames, node, key);
        }
      } else if (child && typeof child === "object") {
        walk(child as ASTNode, nestedShadowedNames, node, key);
      }
    }
  }

  walk(program as unknown as ASTNode, new Set());
}

function resolveRelativeImport(
  context: TriggerContext,
  currentFilePath: string,
  importSource: string,
): TriggerModuleBindings | undefined {
  if (!importSource.startsWith(".")) return undefined;
  const currentDirectory = path.dirname(currentFilePath.replace(/[?#].*$/, ""));
  const modulePath = normalizeFilePath(path.resolve(currentDirectory, importSource));
  return context.modules.get(modulePath) ?? context.modules.get(path.join(modulePath, "index"));
}

function collectLocalTargets(
  program: Program,
  context: TriggerContext,
  currentFilePath: string,
): Map<string, TriggerTarget> {
  const targets = new Map<string, TriggerTarget>();
  const currentModule = context.modules.get(normalizeFilePath(currentFilePath));
  if (currentModule) {
    for (const [localName, target] of currentModule.localBindings) {
      targets.set(localName, target);
    }
  }

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const importSource = statement.source.value;
    if (typeof importSource !== "string") continue;
    const importedModule = resolveRelativeImport(context, currentFilePath, importSource);
    if (!importedModule) continue;

    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") continue;
      if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;

      const importedName =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : getModuleExportName(specifier.imported);
      if (!importedName) continue;
      const target = importedModule.exports.get(importedName);
      if (!target) continue;
      targets.set(specifier.local.name, target);
    }
  }

  return targets;
}

function detectTriggerCallsWithTargets(
  program: Program,
  sourceText: string,
  targets: Map<string, TriggerTarget>,
): ResolvedTriggerCall[] {
  const calls: ResolvedTriggerCall[] = [];
  const targetNames = new Set(targets.keys());

  walkBindingAware(program, targetNames, (node, shadowedNames) => {
    const triggerCall = getTriggerCallInfo(node, sourceText);
    if (!triggerCall || shadowedNames.has(triggerCall.identifierName)) return;
    const target = targets.get(triggerCall.identifierName);
    if (target) {
      calls.push({ ...triggerCall, kind: target.kind, targetName: target.name });
    }
  });

  return calls;
}

export function detectResolvedTriggerCalls(
  program: Program,
  sourceText: string,
  context: TriggerContext,
  currentFilePath: string,
): ResolvedTriggerCall[] {
  return detectTriggerCallsWithTargets(
    program,
    sourceText,
    collectLocalTargets(program, context, currentFilePath),
  );
}

export function transformFunctionTriggers(
  source: string,
  triggerContext: TriggerContext,
  currentFilePath: string,
): string {
  const { program } = parseSync("input.ts", source);
  const localTargets = collectLocalTargets(program, triggerContext, currentFilePath);
  const { authNamespace } = triggerContext;
  const allTriggerCalls = detectTriggerCallsWithTargets(program, source, localTargets);
  const nestedTriggerCalls: Array<{ call: ResolvedTriggerCall; parent: ResolvedTriggerCall }> = [];
  const triggerCalls = allTriggerCalls.filter((call) => {
    const parent = allTriggerCalls.find(
      (other) =>
        other !== call &&
        other.callRange.start <= call.callRange.start &&
        call.callRange.end <= other.callRange.end,
    );
    if (!parent) return true;
    nestedTriggerCalls.push({ call, parent });
    return false;
  });

  for (const { call, parent } of nestedTriggerCalls) {
    logger.warn(
      `Nested trigger call "${call.identifierName}.trigger(...)" inside "${parent.identifierName}.trigger(...)" cannot be converted. Move it to a separate statement and pass the result instead.`,
    );
  }

  const replacements: Replacement[] = [];
  // Whether any workflow trigger invoker was wrapped with the runtime
  // normalizer. Used to decide whether to inject the helper at the top.
  let needsNormalizerHelper = false;

  for (const call of triggerCalls) {
    let transformedCall: string;
    if (call.kind === "workflow") {
      let optionsPart = "";
      if (call.optionsText !== undefined) {
        if (authNamespace) {
          optionsPart = `, ${NORMALIZER_IDENTIFIER}(${call.optionsText})`;
          needsNormalizerHelper = true;
        } else {
          optionsPart = `, ${call.optionsText}`;
        }
      }
      transformedCall = `tailor.workflow.triggerWorkflow(${JSON.stringify(call.targetName)}, ${call.argsText || "undefined"}${optionsPart})`;
    } else {
      const optionsPart = call.optionsText !== undefined ? `, ${call.optionsText}` : "";
      transformedCall = `tailor.workflow.triggerJobFunction(${JSON.stringify(call.targetName)}, ${call.argsText || "undefined"}${optionsPart})`;
    }
    replacements.push({
      start: call.callRange.start,
      end: call.callRange.end,
      text: transformedCall,
    });
  }

  const transformed = applyReplacements(source, replacements);
  return needsNormalizerHelper && authNamespace
    ? buildNormalizerHelperSource(authNamespace) + transformed
    : transformed;
}

export function createTriggerTransformPlugin(
  triggerContext: TriggerContext | undefined,
): Plugin | undefined {
  if (!triggerContext) return undefined;

  return {
    name: "trigger-transform",
    transform: {
      filter: { id: { include: [/\.(ts|mts|cts|js|mjs|cjs)$/] } },
      handler(code, id) {
        if (!code.includes(".trigger(")) return null;
        return { code: transformFunctionTriggers(code, triggerContext, id) };
      },
    },
  };
}
