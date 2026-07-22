/**
 * Plugin Executor Generator
 *
 * Generates TypeScript files for plugin-generated executors.
 * Supports both legacy format (inline trigger/operation) and new format (executorFile/context).
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "pathe";
import { logger, styles } from "#/cli/shared/logger";
import {
  getPluginImportBaseDirs,
  resolveRelativePluginImportPath,
} from "#/cli/shared/plugin-import";
import { isPluginExecutorWithFile } from "#/plugin/guards";
import {
  type PluginGeneratedExecutorLegacy,
  type PluginGeneratedExecutorWithFile,
  type PluginTriggerConfig,
  type PluginOperationConfig,
  type PluginInjectMap,
  type PluginExecutorContext,
} from "#/plugin/types";
import { assertDefined } from "#/utils/assert";
import ml from "#/utils/multiline";
import type {
  PluginExecutorInfoExtended,
  PluginTypeGenerationResult,
  SourceTypeInfo,
} from "#/plugin/manager";

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
 * @param sourceTypeInfoMap - Map of source type names to their source info
 * @param configPath - Path to tailor.config.ts (used for resolving plugin import paths)
 * @returns Array of generated file paths
 */
export function generatePluginExecutorFiles(
  executors: ReadonlyArray<PluginExecutorInfoExtended>,
  outputDir: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeInfoMap?: Map<string, SourceTypeInfo>,
  configPath?: string,
): string[] {
  if (executors.length === 0) {
    return [];
  }

  const generatedFiles: string[] = [];
  const baseDirs = getPluginImportBaseDirs(configPath);

  for (const info of executors) {
    const filePath = generateSingleExecutorFile(
      info,
      outputDir,
      typeGenerationResult,
      sourceTypeInfoMap,
      baseDirs,
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
 * @param info - Plugin executor metadata and definition
 * @param outputDir - Base output directory (e.g., .tailor-sdk)
 * @param typeGenerationResult - Result from plugin type generation
 * @param sourceTypeInfoMap - Map of source type names to their source info
 * @param baseDirs - Base directories for resolving plugin import paths
 * @returns Absolute path to the generated file
 */
function generateSingleExecutorFile(
  info: PluginExecutorInfoExtended,
  outputDir: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeInfoMap?: Map<string, SourceTypeInfo>,
  baseDirs: string[] = [],
): string {
  const pluginDir = sanitizePluginId(info.pluginId);
  const executorOutputDir = path.join(outputDir, pluginDir, "executors");
  fs.mkdirSync(executorOutputDir, { recursive: true });

  const fileName = sanitizeExecutorFileName(info.executor.name);
  const filePath = path.join(executorOutputDir, `${fileName}.ts`);

  let content: string;
  if (isPluginExecutorWithFile(info.executor)) {
    content = generateExecutorFileContentNew(
      info,
      info.executor,
      outputDir,
      typeGenerationResult,
      sourceTypeInfoMap,
      baseDirs,
    );
  } else {
    content = generateExecutorFileContentLegacy(info.executor);
  }

  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Generate TypeScript file content for new format executor (dynamic import).
 * Uses the executor's resolve function to dynamically import the module.
 * @param info - Plugin executor information
 * @param executor - Executor definition with resolve
 * @param outputDir - Base output directory
 * @param typeGenerationResult - Result from plugin type generation
 * @param sourceTypeInfoMap - Map of source type names to their source info
 * @param baseDirs - Base directories for resolving plugin import paths
 * @returns TypeScript source code for executor file
 */
function generateExecutorFileContentNew(
  info: PluginExecutorInfoExtended,
  executor: PluginGeneratedExecutorWithFile,
  outputDir: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeInfoMap?: Map<string, SourceTypeInfo>,
  baseDirs: string[] = [],
): string {
  const { resolve, context } = executor;
  const pluginDir = sanitizePluginId(info.pluginId);
  const executorOutputDir = path.join(outputDir, pluginDir, "executors");

  const executorImportPath = resolveExecutorImportPath(
    resolve,
    info.pluginImportPath,
    executorOutputDir,
    baseDirs,
  );

  // Collect type imports from context
  const typeImports = collectTypeImports(
    context,
    outputDir,
    info.pluginId,
    typeGenerationResult,
    sourceTypeInfoMap,
  );

  // Generate import statements
  const imports: string[] = [];

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

    const { default: executorFactory } = await import(${JSON.stringify(executorImportPath)});
    if (typeof executorFactory !== "function") {
      throw new Error(
        "Plugin executor module must export a default function created by withPluginContext().",
      );
    }
    export default executorFactory(${contextCode});
  `;
}

/**
 * Collect type imports needed for context.
 * @param context - Executor context values from plugin
 * @param outputDir - Base output directory for generated files
 * @param pluginId - Plugin identifier used for output paths
 * @param typeGenerationResult - Result from plugin type generation
 * @param sourceTypeInfoMap - Map of source type names to their source info
 * @returns Map of context keys to their import information
 */
function collectTypeImports(
  context: PluginExecutorContext,
  outputDir: string,
  pluginId: string,
  typeGenerationResult?: PluginTypeGenerationResult,
  sourceTypeInfoMap?: Map<string, SourceTypeInfo>,
): Map<string, TypeImportInfo> {
  const typeImports = new Map<string, TypeImportInfo>();
  const pluginDir = sanitizePluginId(pluginId);
  const executorDir = path.join(outputDir, pluginDir, "executors");

  for (const [key, value] of Object.entries(context)) {
    if (isTypeObject(value)) {
      const typeName = value.name;
      const sourceInfo = sourceTypeInfoMap?.get(typeName);
      const variableName = sourceInfo?.exportName ?? toCamelCase(typeName);

      // Check if it's a generated type
      let importPath: string;
      let isGeneratedType = false;

      if (typeGenerationResult?.typeFilePaths.has(typeName)) {
        // It's a generated type - import from plugin types directory
        const typeFilePath = assertDefined(
          typeGenerationResult.typeFilePaths.get(typeName),
          "type file path missing",
        );
        const absoluteTypePath = path.join(outputDir, typeFilePath);
        importPath = path.relative(executorDir, absoluteTypePath).replace(/\.ts$/, "");
        if (!importPath.startsWith(".")) {
          importPath = `./${importPath}`;
        }
        isGeneratedType = true;
      } else if (sourceInfo) {
        // It's a user-defined type
        const sourceFilePath = sourceInfo.filePath;
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
 * @param context - Executor context values from plugin
 * @param typeImports - Resolved type import information for context keys
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
 * @param value - Value to inspect
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
 * @param executor - Legacy executor definition
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
 * @param inject - Map of injected values keyed by variable name
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
 * @param trigger - Trigger configuration for executor
 * @returns TypeScript code for trigger object
 */
function generateTriggerCode(trigger: PluginTriggerConfig): string {
  switch (trigger.kind) {
    case "tailordb":
      return `{
    kind: ${JSON.stringify(trigger.kind)},
    events: ${JSON.stringify(trigger.events)},
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
 * @param operation - Operation configuration for executor
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
 * @param str - Raw template literal content
 * @returns Escaped string safe for template literals
 */
function escapeTemplateLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

// ============================================================================
// Utility functions
// ============================================================================

const require = createRequire(import.meta.url);

/**
 * Resolve the import path for a plugin executor module.
 * @param resolve - Executor resolve function
 * @param pluginImportPath - Plugin's import path
 * @param executorOutputDir - Directory where the generated executor will be written
 * @param baseDirs - Base directories for resolving plugin import paths
 * @returns Import path string for the executor module
 */
function resolveExecutorImportPath(
  resolve: () => Promise<{ default: unknown }>,
  pluginImportPath: string,
  executorOutputDir: string,
  baseDirs: string[],
): string {
  const specifier = extractDynamicImportSpecifier(resolve);
  if (!specifier.startsWith(".")) {
    return specifier;
  }

  const pluginBaseDir = resolvePluginBaseDir(pluginImportPath, baseDirs);
  if (!pluginBaseDir) {
    throw new Error(
      `Unable to resolve plugin import base for "${pluginImportPath}". ` +
        `Tried base dirs: ${baseDirs.join(", ") || "(none)"}. ` +
        `Use an absolute import specifier in resolve(), or ensure the plugin path is resolvable.`,
    );
  }

  const absolutePath = path.resolve(pluginBaseDir, specifier);
  let relativePath = path.relative(executorOutputDir, absolutePath).replace(/\\/g, "/");
  relativePath = stripSourceExtension(relativePath);
  if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

/**
 * Extract the dynamic import specifier from a resolve function.
 * @param resolve - Executor resolve function
 * @returns The module specifier string
 */
function extractDynamicImportSpecifier(resolve: () => Promise<{ default: unknown }>): string {
  const source = resolve.toString();
  const match = source.match(/import\s*\(\s*["']([^"']+)["']\s*\)/);
  if (!match) {
    throw new Error(
      `resolve() must return a dynamic import, e.g. \`async () => await import("./executors/on-create")\`.`,
    );
  }
  return assertDefined(match[1], "dynamic import specifier capture group missing");
}

/**
 * Resolve plugin base directory for relative imports.
 * @param pluginImportPath - Plugin import path
 * @param baseDirs - Base directories for resolving plugin import paths
 * @returns Directory path or null if not resolvable
 */
function resolvePluginBaseDir(pluginImportPath: string, baseDirs: string[]): string | null {
  if (pluginImportPath.startsWith(".")) {
    const resolvedPath =
      resolveRelativePluginImportPath(pluginImportPath, baseDirs) ??
      path.resolve(baseDirs[0] ?? process.cwd(), pluginImportPath);
    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      return stats.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    }
    return path.extname(resolvedPath) ? path.dirname(resolvedPath) : resolvedPath;
  }

  for (const baseDir of baseDirs) {
    try {
      const resolved = require.resolve(pluginImportPath, { paths: [baseDir] });
      return path.dirname(resolved);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Strip TypeScript source extensions from import paths.
 * @param importPath - Path to normalize
 * @returns Path without .ts/.tsx extension
 */
function stripSourceExtension(importPath: string): string {
  return importPath.replace(/\.(ts|tsx)$/, "");
}

/**
 * Convert plugin ID to safe directory name.
 * @param pluginId - Plugin identifier (e.g., "@scope/name")
 * @returns Safe directory name
 */
function sanitizePluginId(pluginId: string): string {
  return pluginId.replace(/^@/, "").replace(/\//g, "-");
}

/**
 * Convert executor name to safe filename.
 * @param executorName - Executor name
 * @returns Safe filename without extension
 */
function sanitizeExecutorFileName(executorName: string): string {
  const baseName = path.basename(executorName);
  const withoutExtension = baseName.replace(/\.[^/.]+$/, "");
  const sanitized = withoutExtension.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (!sanitized) {
    throw new Error(`Invalid executor name: "${executorName}"`);
  }
  return sanitized;
}

/**
 * Convert string to camelCase.
 * @param str - Input string to convert
 * @returns camelCase string
 */
function toCamelCase(str: string): string {
  const result = str.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
  return result.charAt(0).toLowerCase() + result.slice(1);
}

/**
 * Convert string to kebab-case.
 * @param str - Input string to convert
 * @returns kebab-case string
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}
