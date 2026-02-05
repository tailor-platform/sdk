/**
 * Plugin Executor Generator
 *
 * Generates TypeScript files for plugin-generated executors.
 * Supports both legacy format (inline trigger/operation) and new format (executorFile/context).
 */

import * as fs from "node:fs";
import ml from "multiline-ts";
import * as path from "pathe";
import { logger, styles } from "@/cli/utils/logger";
import {
  isPluginExecutorWithFile,
  type PluginGeneratedExecutorLegacy,
  type PluginGeneratedExecutorWithFile,
  type PluginTriggerConfig,
  type PluginOperationConfig,
  type PluginInjectMap,
  type PluginExecutorContext,
} from "@/parser/plugin-config/types";
import type { PluginTypeGenerationResult } from "./plugin-type-generator";
import type { PluginExecutorInfoExtended } from "@/plugin/manager";

/**
 * Information needed for type import resolution.
 */
interface TypeImportInfo {
  /** Variable name to use in generated code */
  variableName: string;
  /** Import path for the type */
  importPath: string;
  /** Whether this is a generated type (vs user-defined) */
  isGeneratedType: boolean;
}

/**
 * Generate TypeScript files for plugin-generated executors.
 * These files will be processed by the standard executor bundler.
 * @param executors - Array of plugin executor information
 * @param outputDir - Base output directory (e.g., .tailor-sdk)
 * @param typeGenerationResult - Result from plugin type generation (for import resolution)
 * @param sourceTypeFilePaths - Map of source type names to their file paths
 * @returns Array of generated file paths
 */
export function generatePluginExecutorFiles(
  executors: ReadonlyArray<PluginExecutorInfoExtended>,
  outputDir: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeFilePaths?: Map<string, string>,
): string[] {
  if (executors.length === 0) {
    return [];
  }

  const generatedFiles: string[] = [];

  for (const info of executors) {
    const filePath = generateSingleExecutorFile(
      info,
      outputDir,
      typeGenerationResult,
      sourceTypeFilePaths,
    );
    generatedFiles.push(filePath);

    const relativePath = path.relative(process.cwd(), filePath);
    logger.log(
      `  Plugin Executor File: ${styles.success(relativePath)} from plugin ${styles.info(info.pluginId)}`,
    );
  }

  return generatedFiles;
}

/**
 * Generate a single executor file.
 * @param info
 * @param outputDir
 * @param typeGenerationResult
 * @param sourceTypeFilePaths
 * @returns Absolute path to the generated file
 */
function generateSingleExecutorFile(
  info: PluginExecutorInfoExtended,
  outputDir: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeFilePaths?: Map<string, string>,
): string {
  const pluginDir = sanitizePluginId(info.pluginId);
  const executorOutputDir = path.join(outputDir, pluginDir, "executors");
  fs.mkdirSync(executorOutputDir, { recursive: true });

  const filePath = path.join(executorOutputDir, `${info.executor.name}.ts`);

  let content: string;
  if (isPluginExecutorWithFile(info.executor)) {
    content = generateExecutorFileContentNew(
      info,
      info.executor,
      outputDir,
      typeGenerationResult,
      sourceTypeFilePaths,
    );
  } else {
    content = generateExecutorFileContentLegacy(info.executor);
  }

  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Generate TypeScript file content for new format executor (dynamic import).
 * Uses the plugin's `executors` object with dynamic imports for tree-shaking.
 * @param info - Plugin executor information
 * @param executor - Executor definition with executorExport
 * @param outputDir - Base output directory
 * @param typeGenerationResult - Result from plugin type generation
 * @param sourceTypeFilePaths - Map of source type names to their file paths
 * @returns TypeScript source code for executor file
 */
function generateExecutorFileContentNew(
  info: PluginExecutorInfoExtended,
  executor: PluginGeneratedExecutorWithFile,
  outputDir: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeFilePaths?: Map<string, string>,
): string {
  const { executorExport, context } = executor;
  const pluginDir = sanitizePluginId(info.pluginId);
  const executorOutputDir = path.join(outputDir, pluginDir, "executors");

  // Calculate import path for plugin (handle local plugins)
  const pluginImportPath = calculatePluginImportPath(info.pluginImportPath, executorOutputDir);

  // Collect type imports from context
  const typeImports = collectTypeImports(
    context,
    outputDir,
    info.pluginId,
    typeGenerationResult,
    sourceTypeFilePaths,
  );

  // Generate import statements
  const imports: string[] = [`import { executors } from "${pluginImportPath}";`];

  for (const [, importInfo] of typeImports) {
    imports.push(`import { ${importInfo.variableName} } from "${importInfo.importPath}";`);
  }

  // Generate context object code
  const contextCode = generateContextCode(context, typeImports);

  return ml /* ts */ `
    /**
     * Auto-generated executor by plugin: ${info.pluginId}
     * DO NOT EDIT - This file is generated by @tailor-platform/sdk
     */
    ${imports.join("\n")}

    const { default: executorFactory } = await executors.${executorExport}();
    export default executorFactory(${contextCode});
  `;
}

/**
 * Collect type imports needed for context.
 * @param context
 * @param outputDir
 * @param pluginId
 * @param typeGenerationResult
 * @param sourceTypeFilePaths
 * @returns Map of context keys to their import information
 */
function collectTypeImports(
  context: PluginExecutorContext,
  outputDir: string,
  pluginId: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeFilePaths?: Map<string, string>,
): Map<string, TypeImportInfo> {
  const typeImports = new Map<string, TypeImportInfo>();
  const pluginDir = sanitizePluginId(pluginId);
  const executorDir = path.join(outputDir, pluginDir, "executors");

  for (const [key, value] of Object.entries(context)) {
    if (isTypeObject(value)) {
      const typeName = value.name;
      const variableName = toCamelCase(typeName);

      // Check if it's a generated type
      let importPath: string;
      let isGeneratedType = false;

      if (typeGenerationResult?.typeFilePaths.has(typeName)) {
        // It's a generated type - import from plugin types directory
        const typeFilePath = typeGenerationResult.typeFilePaths.get(typeName)!;
        const absoluteTypePath = path.join(outputDir, typeFilePath);
        importPath = path.relative(executorDir, absoluteTypePath).replace(/\.ts$/, "");
        if (!importPath.startsWith(".")) {
          importPath = `./${importPath}`;
        }
        isGeneratedType = true;
      } else if (sourceTypeFilePaths?.has(typeName)) {
        // It's a user-defined type
        const sourceFilePath = sourceTypeFilePaths.get(typeName)!;
        importPath = path.relative(executorDir, sourceFilePath).replace(/\.ts$/, "");
        if (!importPath.startsWith(".")) {
          importPath = `./${importPath}`;
        }
      } else {
        // Fallback: generate relative path assumption
        // This might need adjustment based on actual project structure
        importPath = `../../../../tailordb/${toKebabCase(typeName)}`;
      }

      typeImports.set(key, {
        variableName,
        importPath,
        isGeneratedType,
      });
    }
  }

  return typeImports;
}

/**
 * Generate TypeScript code for context object.
 * @param context
 * @param typeImports
 * @returns TypeScript object literal code
 */
function generateContextCode(
  context: PluginExecutorContext,
  typeImports: Map<string, TypeImportInfo>,
): string {
  const entries: string[] = [];

  for (const [key, value] of Object.entries(context)) {
    if (isTypeObject(value)) {
      const importInfo = typeImports.get(key);
      if (importInfo) {
        entries.push(`  ${key}: ${importInfo.variableName}`);
      }
    } else if (value !== undefined) {
      entries.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  return `{\n${entries.join(",\n")},\n}`;
}

/**
 * Check if a value is a TailorDB type object.
 * @param value
 * @returns True if value is a type object with name and fields
 */
function isTypeObject(value: unknown): value is { name: string; fields: Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "fields" in value &&
    typeof (value as { name: unknown }).name === "string"
  );
}

// ============================================================================
// Legacy format support
// ============================================================================

/**
 * Generate TypeScript file content for legacy format executor (trigger/operation).
 * @param executor
 * @returns TypeScript source code for executor file
 */
function generateExecutorFileContentLegacy(executor: PluginGeneratedExecutorLegacy): string {
  const triggerCode = generateTriggerCode(executor.trigger);
  const operationCode = generateOperationCode(executor.operation);

  // Extract inject from function operation
  const inject = executor.operation.kind === "function" ? executor.operation.inject : undefined;
  const injectDeclarations = generateInjectDeclarations(inject);

  const descriptionLine = executor.description
    ? `\n  description: ${JSON.stringify(executor.description)},`
    : "";

  return ml /* ts */ `
    /**
     * Auto-generated executor by plugin
     * DO NOT EDIT - This file is generated by @tailor-platform/sdk
     */
    import { createExecutor } from "@tailor-platform/sdk";
    ${injectDeclarations}
    export default createExecutor({
      name: ${JSON.stringify(executor.name)},${descriptionLine}
      trigger: ${triggerCode},
      operation: ${operationCode},
    });
  `;
}

/**
 * Generate const declarations for injected variables.
 * @param inject
 * @returns TypeScript const declarations or empty string
 */
function generateInjectDeclarations(inject: PluginInjectMap | undefined): string {
  if (!inject || Object.keys(inject).length === 0) {
    return "";
  }

  const declarations = Object.entries(inject)
    .map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`)
    .join("\n");

  return `\n// Injected variables from plugin\n${declarations}\n`;
}

/**
 * Generate TypeScript code for trigger configuration.
 * @param trigger
 * @returns TypeScript code for trigger object
 */
function generateTriggerCode(trigger: PluginTriggerConfig): string {
  switch (trigger.kind) {
    case "recordCreated":
    case "recordUpdated":
    case "recordDeleted":
      return `{
    kind: ${JSON.stringify(trigger.kind)},
    typeName: ${JSON.stringify(trigger.typeName)},
  }`;

    case "schedule":
      return `{
    kind: "schedule",
    cron: ${JSON.stringify(trigger.cron)},
    timezone: ${JSON.stringify(trigger.timezone ?? "UTC")},
  }`;

    case "incomingWebhook":
      return `{
    kind: "incomingWebhook",
  }`;

    default:
      throw new Error(`Unknown trigger kind: ${(trigger as PluginTriggerConfig).kind}`);
  }
}

/**
 * Generate TypeScript code for operation configuration.
 * @param operation
 * @returns TypeScript code for operation object
 */
function generateOperationCode(operation: PluginOperationConfig): string {
  switch (operation.kind) {
    case "graphql": {
      const appNameLine = operation.appName
        ? `\n    appName: ${JSON.stringify(operation.appName)},`
        : "";
      const variablesLine = operation.variables ? `\n    variables: ${operation.variables},` : "";

      return `{
    kind: "graphql",
    query: \`${escapeTemplateLiteral(operation.query)}\`,${appNameLine}${variablesLine}
  }`;
    }

    case "function":
      return `{
    kind: "function",
    body: ${operation.body},
  }`;

    case "webhook":
      return `{
    kind: "webhook",
    url: () => ${JSON.stringify(operation.url)},
  }`;

    case "workflow":
      return `{
    kind: "workflow",
    workflowName: ${JSON.stringify(operation.workflowName)},
  }`;

    default:
      throw new Error(`Unknown operation kind: ${(operation as PluginOperationConfig).kind}`);
  }
}

/**
 * Escape special characters in template literal content.
 * @param str
 * @returns Escaped string safe for template literals
 */
function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Calculate the import path for plugin's executors object.
 * For npm packages (e.g., "@tailor-platform/sdk/change-history-plugin"), use as-is.
 * For relative paths (e.g., "./plugins/soft-delete"), calculate relative path from output location.
 * @param pluginImportPath - Plugin's import path
 * @param executorOutputDir - Directory where the generated executor will be written
 * @returns Import path string for the plugin module
 */
function calculatePluginImportPath(pluginImportPath: string, executorOutputDir: string): string {
  // Check if it's a relative path (local plugin)
  if (pluginImportPath.startsWith(".")) {
    // Local plugin: calculate relative path from output location to plugin's index
    const pluginPath = path.join(process.cwd(), pluginImportPath);
    let relativePath = path.relative(executorOutputDir, pluginPath);
    if (!relativePath.startsWith(".")) {
      relativePath = `./${relativePath}`;
    }
    return relativePath;
  }

  // npm package: use as-is
  return pluginImportPath;
}

/**
 * Convert plugin ID to safe directory name.
 * @param pluginId
 * @returns Safe directory name
 */
function sanitizePluginId(pluginId: string): string {
  return pluginId.replace(/^@/, "").replace(/\//g, "-");
}

/**
 * Convert string to camelCase.
 * @param str
 * @returns camelCase string
 */
function toCamelCase(str: string): string {
  const result = str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
  return result.charAt(0).toLowerCase() + result.slice(1);
}

/**
 * Convert string to kebab-case.
 * @param str
 * @returns kebab-case string
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}
