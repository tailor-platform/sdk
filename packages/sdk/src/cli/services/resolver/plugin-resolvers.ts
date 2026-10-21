import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { z } from "zod";
import { getDistDir } from "#/cli/shared/dist-dir";
import { CLIError } from "#/cli/shared/errors";
import { findUndefinedReferences } from "#/cli/shared/free-variables";
import { flattenZodIssues, formatIssueList } from "#/cli/shared/zod-issues";
import { ResolverSchema } from "#/parser/service/resolver/schema";
import { stringifyFunction } from "#/parser/service/tailordb/field";
import type { PluginResolverInfo } from "#/plugin/manager";
import type { TailorField } from "#/types/field.generated";

const PluginResolverSchema = ResolverSchema.extend({ body: z.string() });

/**
 * Generate validated resolver modules for the standard loader and bundler.
 * @param namespace - Resolver namespace to generate files for
 * @param configPath - Path to the application's config
 * @param resolvers - Plugin resolver definitions in one namespace
 * @returns Absolute paths of generated resolver modules
 */
export function generatePluginResolverFiles(
  namespace: string,
  configPath: string,
  resolvers: ReadonlyArray<PluginResolverInfo>,
): string[] {
  const outputDir = path.resolve(
    getDistDir(),
    "plugin",
    "resolvers",
    createHash("sha256")
      .update(JSON.stringify([path.resolve(configPath), namespace]))
      .digest("hex"),
  );
  fs.rmSync(outputDir, { recursive: true, force: true });
  return resolvers.map((info, index) => {
    const { resolver, pluginId, namespace, sourceTableName } = info;
    const source = `plugin "${pluginId}" in namespace "${namespace}"${sourceTableName ? ` on table "${sourceTableName}"` : ""}`;
    const context = {
      kind: "resolver",
      file: configPath,
      pluginId,
      namespace,
      sourceTableName,
      resolverName: resolver.name,
    };
    const parsed = PluginResolverSchema.safeParse({
      name: resolver.name,
      operation: resolver.operation,
      input: resolver.inputFields,
      output: { type: "nested", metadata: { required: true }, fields: resolver.outputFields },
      body: resolver.body,
    });
    if (!parsed.success) {
      const issues = flattenZodIssues(parsed.error.issues).map((issue) => {
        const [head, ...tail] = issue.path;
        const path =
          head === "input"
            ? ["inputFields", ...tail]
            : head === "output"
              ? ["outputFields", ...tail.slice(1)]
              : issue.path;
        return { ...issue, path };
      });
      throw CLIError({
        code: "DEFINITION_INVALID",
        message: `Invalid resolver "${resolver.name}" from ${source}:\n${formatIssueList(issues)}`,
        context: { ...context, issues },
      });
    }
    let code: string;
    try {
      code = `
    const $tailor_plugin_field = (type, metadata, fields) => ({ type, metadata, _metadata: metadata, fields });
    export default {
      name: ${JSON.stringify(parsed.data.name)},
      operation: ${JSON.stringify(parsed.data.operation)},
      input: ${parsed.data.input === undefined ? "undefined" : serializeFields(parsed.data.input)},
      output: ${serializeField(parsed.data.output)},
      body: async (context) => {\n${resolver.body}\n}
    };\n`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw CLIError({
        code: "PLUGIN_RESOLVER_INVALID",
        message: `Invalid resolver "${resolver.name}" from ${source}: ${message}`,
        context,
        cause,
      });
    }
    const file = path.resolve(
      outputDir,
      `${index}-${encodeURIComponent(pluginId)}-${encodeURIComponent(resolver.name)}-${createHash("sha256").update(code).digest("hex")}.ts`,
    );
    const { errors } = parseSync(file, code);
    if (errors.length > 0) {
      throw CLIError({
        code: "PLUGIN_RESOLVER_INVALID",
        message: `Invalid JavaScript for resolver "${resolver.name}" from ${source}: ${errors.map((error) => error.message).join("; ")}`,
        details: `Generated code:\n${code}`,
        context: {
          ...context,
          issues: errors.map((error) => ({ path: ["body"], message: error.message })),
        },
      });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code);
    return file;
  });
}

function serializeFields(fields: Record<string, TailorField>): string {
  return `{${Object.entries(fields)
    .map(([name, field]) => `[${JSON.stringify(name)}]:${serializeField(field)}`)
    .join(",")}}`;
}

function serializeField(field: TailorField): string {
  const metadata = serializeValue(field.metadata);
  return `$tailor_plugin_field(${JSON.stringify(field.type)},${metadata},${serializeFields(field.fields)})`;
}

function serializeValue(value: unknown): string {
  if (typeof value === "function") {
    const code = `(${stringifyFunction(value)})`;
    const references = findUndefinedReferences(code, { includeGuardedReferences: true });
    if (references.size > 0) {
      throw new Error(
        `Field functions must be self-contained; unresolved references: ${[...references].join(", ")}.`,
      );
    }
    return code;
  }
  if (value === undefined) return "undefined";
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `[${JSON.stringify(key)}]:${serializeValue(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "symbol")
    throw new Error("Plugin resolver fields contain an unsupported value.");
  return JSON.stringify(value);
}
