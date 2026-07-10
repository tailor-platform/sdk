import { createPathsMatcher } from "get-tsconfig";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { logger } from "#/cli/shared/logger";
import { normalizeTriggerModulePath } from "#/cli/shared/trigger-path";
import {
  type ASTNode,
  type Replacement,
  type TriggerCallInfo,
  applyReplacements,
  findStatementEnd,
  getModuleExportName,
  getTriggerCallInfo,
} from "./ast-utils";
import type {
  TriggerContext,
  TriggerModuleBindings,
  TriggerTarget,
} from "#/cli/shared/trigger-context.types";
import type { Program, ImportDeclaration } from "@oxc-project/types";

export interface ResolvedTriggerCall extends TriggerCallInfo {
  kind: "job" | "workflow";
  targetName: string;
}

/**
 * Name of the injected runtime normalizer helper. Chosen to be unique enough
 * to avoid collisions with user code.
 */
const NORMALIZER_IDENTIFIER = "__tailor_normalizeTriggerOptions";

/**
 * Build the source text of the injected normalizer helper.
 *
 * Expands a plain-string `authInvoker` (machine user name) in the trigger
 * options to the object form `{ namespace, machineUserName }`; any other
 * options value passes through unchanged. The auth namespace is baked in at
 * bundle time.
 * @param authNamespace - Auth service namespace to embed
 * @returns Source line defining the helper
 */
function buildNormalizerHelperSource(authNamespace: string): string {
  return `const ${NORMALIZER_IDENTIFIER} = (o) => o && typeof o.authInvoker === "string" ? { ...o, authInvoker: { namespace: ${JSON.stringify(authNamespace)}, machineUserName: o.authInvoker } } : o;\n`;
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
  if (
    statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
  ) {
    return statement.declaration as ASTNode | undefined;
  }
  return statement;
}

function collectLexicalBindings(statements: ASTNode[], names: Set<string>): void {
  for (const statement of statements) {
    const declaration = declarationNode(statement);
    if (!declaration) continue;

    if (declaration.type === "VariableDeclaration") {
      if (declaration.kind === "var") continue;
      for (const declarator of declaration.declarations as ASTNode[]) {
        collectBindingNames(declarator.id as ASTNode, names);
      }
      continue;
    }

    if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration" ||
      declaration.type === "TSEnumDeclaration" ||
      declaration.type === "TSModuleDeclaration" ||
      declaration.type === "TSImportEqualsDeclaration"
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
        node.type === "StaticBlock" ||
        node.type === "TSModuleBlock")
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

function isFunctionNode(node: ASTNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function addShadowedBindings(
  shadowedNames: ReadonlySet<string>,
  bindings: Set<string>,
  targetNames: Set<string>,
): ReadonlySet<string> {
  const relevantBindings = [...bindings].filter((name) => targetNames.has(name));
  return relevantBindings.length > 0
    ? new Set([...shadowedNames, ...relevantBindings])
    : shadowedNames;
}

function collectScopeBindings(node: ASTNode): Set<string> {
  const names = new Set<string>();

  if (node.type === "ClassExpression") {
    collectBindingNames(node.id as ASTNode | undefined, names);
    return names;
  }

  if (
    node.type === "BlockStatement" ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock"
  ) {
    collectLexicalBindings(node.body as ASTNode[], names);
    if (node.type === "StaticBlock" || node.type === "TSModuleBlock") {
      collectFunctionVarBindings(node, names);
    }
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

  return names;
}

function collectSwitchBindings(node: ASTNode): Set<string> {
  const names = new Set<string>();
  for (const switchCase of node.cases as ASTNode[]) {
    collectLexicalBindings(switchCase.consequent as ASTNode[], names);
  }
  return names;
}

function walkBindingAware(
  program: Program,
  targetNames: Set<string>,
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
    excludedKey?: string,
  ): void {
    if (!node || typeof node !== "object" || node.type === "ImportDeclaration") return;

    if (isFunctionNode(node)) {
      const headerBindings = new Set<string>();
      collectBindingNames(node.id as ASTNode | undefined, headerBindings);
      for (const param of node.params as ASTNode[]) {
        collectBindingNames(param, headerBindings);
      }
      const headerShadowedNames = addShadowedBindings(shadowedNames, headerBindings, targetNames);
      const varBindings = new Set<string>();
      collectFunctionVarBindings(node, varBindings);
      const bodyShadowedNames = addShadowedBindings(headerShadowedNames, varBindings, targetNames);

      visitor(node, headerShadowedNames, parentNode, parentKey);
      for (const key of Object.keys(node)) {
        if (key === "parent" || key === excludedKey) continue;
        const child = node[key] as unknown;
        if (key === "params" && Array.isArray(child)) {
          for (const item of child) {
            const parameter = item as ASTNode;
            for (const decorator of (parameter.decorators as ASTNode[] | undefined) ?? []) {
              walk(decorator, shadowedNames, parameter, "decorators");
            }
            walk(parameter, headerShadowedNames, node, key, "decorators");
          }
          continue;
        }
        const childShadowedNames = key === "body" ? bodyShadowedNames : headerShadowedNames;
        if (Array.isArray(child)) {
          for (const item of child) {
            walk(item as ASTNode | null, childShadowedNames, node, key);
          }
        } else if (child && typeof child === "object") {
          walk(child as ASTNode, childShadowedNames, node, key);
        }
      }
      return;
    }

    let nestedShadowedNames = shadowedNames;
    if (node.type !== "Program") {
      nestedShadowedNames = addShadowedBindings(
        shadowedNames,
        collectScopeBindings(node),
        targetNames,
      );
    }

    visitor(node, nestedShadowedNames, parentNode, parentKey);

    if (node.type === "SwitchStatement") {
      walk(node.discriminant as ASTNode, nestedShadowedNames, node, "discriminant");
      const caseShadowedNames = addShadowedBindings(
        nestedShadowedNames,
        collectSwitchBindings(node),
        targetNames,
      );
      for (const switchCase of node.cases as ASTNode[]) {
        walk(switchCase, caseShadowedNames, node, "cases");
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === "parent" || key === excludedKey) continue;
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

function buildReferenceCountMap(program: Program, names: Set<string>): Map<string, number> {
  const counts = new Map([...names].map((name) => [name, 0]));
  if (names.size === 0) return counts;

  walkBindingAware(program, names, (node, shadowedNames, parentNode, parentKey) => {
    if (node.type === "Identifier") {
      const identName = node.name as string;
      if (names.has(identName) && !shadowedNames.has(identName)) {
        const isMemberProperty =
          parentNode &&
          parentNode.type === "MemberExpression" &&
          parentKey === "property" &&
          !parentNode.computed;
        const isObjectPropertyKey =
          parentNode &&
          parentNode.type === "Property" &&
          parentKey === "key" &&
          !parentNode.shorthand &&
          !parentNode.computed;

        if (!isMemberProperty && !isObjectPropertyKey) {
          counts.set(identName, (counts.get(identName) ?? 0) + 1);
        }
      }
    }
  });
  return counts;
}

/**
 * Build source replacements for dead workflow imports.
 * @param program - The parsed AST program
 * @param deadLocalNames - Local import bindings with no remaining references
 * @param source - Original source text used to preserve import specifiers
 * @returns Non-overlapping import declaration replacements
 */
function buildWorkflowImportReplacements(
  program: Program,
  deadLocalNames: ReadonlySet<string>,
  source: string,
): Replacement[] {
  const replacements: Replacement[] = [];

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;

    const importDecl = statement as unknown as ImportDeclaration;
    const specifiers = importDecl.specifiers;
    const retainedSpecifiers = specifiers.filter(
      (specifier) => !deadLocalNames.has(specifier.local.name),
    );
    if (retainedSpecifiers.length === specifiers.length) continue;

    if (retainedSpecifiers.length === 0) {
      replacements.push({
        start: importDecl.start,
        end: findStatementEnd(source, importDecl.end),
        text: "",
      });
      continue;
    }

    const firstSpecifier = specifiers[0];
    const lastSpecifier = specifiers.at(-1);
    if (!firstSpecifier || !lastSpecifier) continue;
    const namedGroupStart = source.lastIndexOf("{", firstSpecifier.start);
    const clauseStart =
      firstSpecifier.type === "ImportSpecifier" && namedGroupStart >= importDecl.start
        ? namedGroupStart
        : firstSpecifier.start;
    const namedGroupEnd = source.indexOf("}", lastSpecifier.end);
    const clauseEnd =
      lastSpecifier.type === "ImportSpecifier" &&
      namedGroupEnd >= lastSpecifier.end &&
      namedGroupEnd < importDecl.end
        ? namedGroupEnd + 1
        : lastSpecifier.end;

    const defaultSpecifier = retainedSpecifiers.find(
      (specifier) => specifier.type === "ImportDefaultSpecifier",
    );
    const namespaceSpecifier = retainedSpecifiers.find(
      (specifier) => specifier.type === "ImportNamespaceSpecifier",
    );
    const namedSpecifiers = retainedSpecifiers.filter(
      (specifier) => specifier.type === "ImportSpecifier",
    );
    const clauseParts: string[] = [];
    if (defaultSpecifier) {
      clauseParts.push(source.slice(defaultSpecifier.start, defaultSpecifier.end));
    }
    if (namespaceSpecifier) {
      clauseParts.push(source.slice(namespaceSpecifier.start, namespaceSpecifier.end));
    }
    if (namedSpecifiers.length > 0) {
      clauseParts.push(
        `{ ${namedSpecifiers.map((specifier) => source.slice(specifier.start, specifier.end)).join(", ")} }`,
      );
    }

    replacements.push({
      start: clauseStart,
      end: clauseEnd,
      text: clauseParts.join(", "),
    });
  }

  return replacements;
}

/**
 * Resolve trigger calls against the current module's lexical and import bindings.
 * @param program - Parsed source program
 * @param sourceText - Original source text
 * @param context - Project trigger binding metadata
 * @param currentFilePath - Path of the source module
 * @returns Trigger calls whose object binding resolves to a configured job or workflow
 */
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

function detectTriggerCallsWithTargets(
  program: Program,
  sourceText: string,
  localTargets: LocalTriggerTargets,
): ResolvedTriggerCall[] {
  const { targets, namespaceTargets } = localTargets;
  const calls: ResolvedTriggerCall[] = [];
  const targetNames = new Set([...targets.keys(), ...namespaceTargets.keys()]);

  walkBindingAware(program, targetNames, (node, shadowedNames) => {
    const triggerCall = getTriggerCallInfo(node, sourceText);
    if (!triggerCall || shadowedNames.has(triggerCall.identifierName)) return;
    const target = triggerCall.namespaceExportName
      ? namespaceTargets.get(triggerCall.identifierName)?.get(triggerCall.namespaceExportName)
      : targets.get(triggerCall.identifierName);
    if (target) {
      calls.push({
        ...triggerCall,
        kind: target.kind,
        targetName: target.name,
      });
    }
  });

  return calls;
}

function resolveImportBindings(
  context: TriggerContext,
  currentFilePath: string,
  importSource: string,
) {
  function findModule(candidate: string) {
    const modulePath = normalizeTriggerModulePath(candidate);
    return context.modules.get(modulePath) ?? context.modules.get(path.join(modulePath, "index"));
  }

  if (importSource.startsWith(".")) {
    const currentDir = path.dirname(currentFilePath.replace(/[?#].*$/, ""));
    return findModule(path.resolve(currentDir, importSource));
  }

  const resolution = context.moduleResolution;
  if (!resolution) return undefined;
  const matchPaths = createPathsMatcher(resolution);
  for (const candidate of matchPaths?.(importSource) ?? []) {
    const module = findModule(candidate);
    if (module) return module;
  }
  return undefined;
}

interface LocalTriggerTargets {
  targets: Map<string, TriggerTarget>;
  namespaceTargets: Map<string, TriggerModuleBindings["exports"]>;
  workflowImportNames: Set<string>;
}

function collectLocalTargets(
  program: Program,
  context: TriggerContext,
  currentFilePath: string,
): LocalTriggerTargets {
  const targets = new Map<string, TriggerTarget>();
  const namespaceTargets = new Map<string, TriggerModuleBindings["exports"]>();
  const workflowImportNames = new Set<string>();
  const currentModule = context.modules.get(normalizeTriggerModulePath(currentFilePath));
  if (currentModule) {
    for (const [localName, target] of currentModule.localBindings) {
      targets.set(localName, target);
    }
  }

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const importSource = statement.source.value;
    if (typeof importSource !== "string") continue;
    const importedModule = resolveImportBindings(context, currentFilePath, importSource);
    if (!importedModule) continue;

    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaceTargets.set(specifier.local.name, importedModule.exports);
        if (importedModule.exports.get("default")?.kind === "workflow") {
          workflowImportNames.add(specifier.local.name);
        }
        continue;
      }

      let importedName: string | undefined;
      if (specifier.type === "ImportDefaultSpecifier") {
        importedName = "default";
      } else {
        importedName = getModuleExportName(specifier.imported);
      }
      if (!importedName) continue;

      const target = importedModule.exports.get(importedName);
      if (!target) continue;
      targets.set(specifier.local.name, target);
      if (importedName === "default" && target.kind === "workflow") {
        workflowImportNames.add(specifier.local.name);
      }
    }
  }

  return { targets, namespaceTargets, workflowImportNames };
}

/**
 * Transform trigger calls for resolver/executor/workflow functions
 * Handles job.trigger() and workflow.trigger() calls
 * @param source - The source code to transform
 * @param triggerContext - Module binding metadata for workflows and jobs
 * @param currentFilePath - Path of the current file being transformed
 * @returns Transformed source code with trigger calls rewritten
 */
export function transformFunctionTriggers(
  source: string,
  triggerContext: TriggerContext,
  currentFilePath: string,
): string {
  const { program } = parseSync("input.ts", source);
  const localTargets = collectLocalTargets(program, triggerContext, currentFilePath);
  const { workflowImportNames } = localTargets;
  const { authNamespace } = triggerContext;

  // Detect trigger calls only for known workflows and jobs.
  // When trigger calls nest, keep only the outermost one: the outer
  // replacement text is built from the original source, so applying an inner
  // replacement as well would corrupt the output.
  const allTriggerCalls = detectTriggerCallsWithTargets(program, source, localTargets);
  const nestedTriggerCalls: Array<{ call: ResolvedTriggerCall; parent: ResolvedTriggerCall }> = [];
  const triggerCalls = allTriggerCalls.filter((call) => {
    const parent = allTriggerCalls.find(
      (other) =>
        other !== call &&
        other.callRange.start <= call.callRange.start &&
        call.callRange.end <= other.callRange.end,
    );
    if (parent) {
      nestedTriggerCalls.push({ call, parent });
      return false;
    }
    return true;
  });

  for (const { call, parent } of nestedTriggerCalls) {
    logger.warn(
      `Nested trigger call "${call.identifierName}.trigger(...)" inside "${parent.identifierName}.trigger(...)" cannot be converted. Move it to a separate statement and pass the result instead.`,
    );
  }

  const replacements: Replacement[] = [];
  // Whether any workflow trigger authInvoker was wrapped with the runtime
  // normalizer. Used to decide whether to inject the helper at the top.
  let needsNormalizerHelper = false;

  // Track how many trigger calls were transformed per identifier (for dead import detection)
  const transformedCallsPerIdentifier = new Map<string, number>();

  for (const call of triggerCalls) {
    if (call.kind === "workflow") {
      // Wrap the options with the runtime normalizer so a string-form
      // authInvoker in any options shape (object literal, variable
      // reference, spread) becomes the object form the platform RPC
      // expects. The normalizer is injected once at the top of the file.
      // When no auth service is configured we can't expand a string, so
      // we pass through unchanged (platform will reject a string with a
      // clear error).
      let optionsPart = "";
      if (call.optionsText !== undefined) {
        if (authNamespace) {
          optionsPart = `, ${NORMALIZER_IDENTIFIER}(${call.optionsText})`;
          needsNormalizerHelper = true;
        } else {
          optionsPart = `, ${call.optionsText}`;
        }
      }
      // Transform to tailor.workflow.triggerWorkflow
      const transformedCall = `tailor.workflow.triggerWorkflow(${JSON.stringify(call.targetName)}, ${call.argsText || "undefined"}${optionsPart})`;
      replacements.push({
        start: call.callRange.start,
        end: call.callRange.end,
        text: transformedCall,
      });
      transformedCallsPerIdentifier.set(
        call.identifierName,
        (transformedCallsPerIdentifier.get(call.identifierName) ?? 0) + 1,
      );
    } else {
      const optionsPart = call.optionsText !== undefined ? `, ${call.optionsText}` : "";
      const transformedCall = `(async () => tailor.workflow.triggerJobFunction(${JSON.stringify(call.targetName)}, ${call.argsText || "undefined"}${optionsPart}))()`;

      replacements.push({
        start: call.callRange.start,
        end: call.callRange.end,
        text: transformedCall,
      });
      transformedCallsPerIdentifier.set(
        call.identifierName,
        (transformedCallsPerIdentifier.get(call.identifierName) ?? 0) + 1,
      );
    }
  }

  // Remove default import declarations that became dead after trigger transformation.
  // A default import is dead when it has no remaining references, either because
  // it was already unused or because all references to its local identifier were
  // .trigger() calls that have been rewritten above.
  // Single AST pass for all candidate names; scope-aware to ignore shadowed references.
  const refCounts = buildReferenceCountMap(program, workflowImportNames);
  const deadWorkflowImports = new Set<string>();

  for (const localName of workflowImportNames) {
    const transformedCount = transformedCallsPerIdentifier.get(localName) ?? 0;
    const refCount = refCounts.get(localName) ?? 0;

    if (refCount === 0 || transformedCount >= refCount) {
      deadWorkflowImports.add(localName);
    }
  }

  replacements.push(...buildWorkflowImportReplacements(program, deadWorkflowImports, source));

  const transformed = applyReplacements(source, replacements);

  // Inject the normalizer helper at the top of the file if we referenced it.
  // Each module gets its own copy; rolldown keeps module scopes separate so
  // there is no cross-module naming conflict.
  if (needsNormalizerHelper && authNamespace) {
    return buildNormalizerHelperSource(authNamespace) + transformed;
  }

  return transformed;
}
