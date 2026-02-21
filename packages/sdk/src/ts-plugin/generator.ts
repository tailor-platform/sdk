/**
 * Generates `tailor-env.d.ts` content from a manifest.
 *
 * Produces `declare module` augmentations that map each namespace/type
 * pair to `InferTable<typeof import(...)["exportName"]>` for Kysely,
 * and `GeneratedGqlSchema` entries for GraphQL type inference.
 */

import * as inflection from "inflection";
import * as path from "pathe";
import type { Manifest, ManifestTypeEntry } from "@/cli/generator/manifest";

/**
 * Compute the relative import path from outputDir to a type's source file.
 * @param manifest - The manifest containing configDir
 * @param outputDir - Absolute path to the directory where the .d.ts will be written
 * @param filePath - Relative file path from configDir
 * @returns Import specifier like `"./tailordb/salesOrder"`
 */
function computeImportPath(manifest: Manifest, outputDir: string, filePath: string): string {
  const absolutePath = path.resolve(manifest.configDir, filePath);
  const relativePath = path.relative(outputDir, absolutePath);
  return `./${relativePath.replace(/\\/g, "/").replace(/\.ts$/, "")}`;
}

/**
 * Generate the Kysely GeneratedNamespace block.
 * @param manifest - The manifest describing namespaces and types
 * @param outputDir - Absolute path to the output directory
 * @returns Lines for the Kysely module augmentation
 */
function generateKyselyBlock(manifest: Manifest, outputDir: string): string[] {
  const lines: string[] = [
    'declare module "@tailor-platform/sdk/kysely" {',
    "  interface GeneratedNamespace {",
  ];

  for (const [namespace, nsData] of Object.entries(manifest.namespaces)) {
    lines.push(`    ${namespace}: {`);
    for (const entry of nsData.types) {
      const importPath = computeImportPath(manifest, outputDir, entry.filePath);
      lines.push(
        `      ${entry.typeName}: InferTable<(typeof import("${importPath}"))["${entry.exportName}"]>;`,
      );
    }
    lines.push("    };");
  }

  lines.push("  }");
  lines.push("}");
  return lines;
}

/**
 * Check if a GraphQL operation is enabled for a type entry.
 * @param entry - The manifest type entry
 * @param operation - The operation to check
 * @returns True if the operation is enabled (default is enabled)
 */
function isOperationEnabled(
  entry: ManifestTypeEntry,
  operation: "create" | "update" | "delete" | "read",
): boolean {
  if (!entry.gqlOperations) return true;
  return entry.gqlOperations[operation] !== false;
}

/**
 * Generate GraphQL schema entries for a single type.
 * @param entry - The manifest type entry
 * @param importPath - The import path for the type
 * @returns Lines for the GraphQL schema entries
 */
function generateGqlEntriesForType(entry: ManifestTypeEntry, importPath: string): string[] {
  const lines: string[] = [];
  const typeRef = `(typeof import("${importPath}"))["${entry.exportName}"]`;
  const getQueryName = inflection.camelize(entry.typeName, true);
  const listQueryName = inflection.camelize(entry.pluralForm, true);

  // get query
  if (isOperationEnabled(entry, "read")) {
    lines.push(`    ${getQueryName}: {`);
    lines.push(`      variables: { id: string };`);
    lines.push(`      result: { ${getQueryName}: InferGqlResult<${typeRef}> | null };`);
    lines.push("    };");

    // list query
    lines.push(`    ${listQueryName}: {`);
    lines.push(`      variables: Record<string, unknown>;`);
    lines.push(`      result: { ${listQueryName}: { collection: InferGqlResult<${typeRef}>[] } };`);
    lines.push("    };");
  }

  // create mutation
  if (isOperationEnabled(entry, "create")) {
    const createName = `create${entry.typeName}`;
    lines.push(`    ${createName}: {`);
    lines.push(`      variables: { input: InferCreateInput<${typeRef}> };`);
    lines.push(`      result: { ${createName}: InferGqlResult<${typeRef}> };`);
    lines.push("    };");
  }

  // update mutation
  if (isOperationEnabled(entry, "update")) {
    const updateName = `update${entry.typeName}`;
    lines.push(`    ${updateName}: {`);
    lines.push(`      variables: { id: string; input: InferUpdateInput<${typeRef}> };`);
    lines.push(`      result: { ${updateName}: InferGqlResult<${typeRef}> };`);
    lines.push("    };");
  }

  // delete mutation
  if (isOperationEnabled(entry, "delete")) {
    const deleteName = `delete${entry.typeName}`;
    lines.push(`    ${deleteName}: {`);
    lines.push(`      variables: { id: string };`);
    lines.push(`      result: { ${deleteName}: { id: string } };`);
    lines.push("    };");
  }

  // bulkUpsert mutation
  if (entry.bulkUpsert && isOperationEnabled(entry, "create")) {
    const bulkUpsertName = `bulkUpsert${entry.pluralForm}`;
    lines.push(`    ${bulkUpsertName}: {`);
    lines.push(`      variables: { input: InferCreateInput<${typeRef}>[] };`);
    lines.push(`      result: { ${bulkUpsertName}: InferGqlResult<${typeRef}>[] };`);
    lines.push("    };");
  }

  return lines;
}

/**
 * Generate GraphQL type name → TS type mapping entries for a single type.
 * Produces `{TypeName}CreateInput` and `{TypeName}UpdateInput` entries.
 * @param entry - The manifest type entry
 * @param importPath - The import path for the type
 * @returns Lines for the GeneratedGqlTypes entries
 */
function generateGqlTypesForType(entry: ManifestTypeEntry, importPath: string): string[] {
  const lines: string[] = [];
  const typeRef = `(typeof import("${importPath}"))["${entry.exportName}"]`;

  if (isOperationEnabled(entry, "create")) {
    lines.push(`    ${entry.typeName}CreateInput: InferCreateInput<${typeRef}>;`);
  }

  if (isOperationEnabled(entry, "update")) {
    lines.push(`    ${entry.typeName}UpdateInput: InferUpdateInput<${typeRef}>;`);
  }

  return lines;
}

/**
 * Generate the GraphQL GeneratedGqlSchema and GeneratedGqlTypes blocks.
 * @param manifest - The manifest describing namespaces and types
 * @param outputDir - Absolute path to the output directory
 * @returns Lines for the GraphQL module augmentation, or empty if no types
 */
function generateGqlBlock(manifest: Manifest, outputDir: string): string[] {
  const allEntries: { entry: ManifestTypeEntry; importPath: string }[] = [];

  for (const nsData of Object.values(manifest.namespaces)) {
    for (const entry of nsData.types) {
      const importPath = computeImportPath(manifest, outputDir, entry.filePath);
      allEntries.push({ entry, importPath });
    }
  }

  if (allEntries.length === 0) return [];

  const lines: string[] = [
    'declare module "@tailor-platform/sdk/graphql" {',
    "  interface GeneratedGqlSchema {",
  ];

  for (const { entry, importPath } of allEntries) {
    lines.push(...generateGqlEntriesForType(entry, importPath));
  }

  lines.push("  }");

  // GeneratedGqlTypes: maps GraphQL type names to TS types for variable parsing
  const gqlTypesLines: string[] = [];
  for (const { entry, importPath } of allEntries) {
    gqlTypesLines.push(...generateGqlTypesForType(entry, importPath));
  }

  if (gqlTypesLines.length > 0) {
    lines.push("  interface GeneratedGqlTypes {");
    lines.push(...gqlTypesLines);
    lines.push("  }");
  }

  lines.push("}");
  return lines;
}

/**
 * Generate the content of `tailor-env.d.ts` from a manifest.
 * @param manifest - The manifest describing namespaces and types
 * @param outputDir - Absolute path to the directory where the .d.ts will be written
 * @returns The content string for `tailor-env.d.ts`
 */
export function generateDts(manifest: Manifest, outputDir: string): string {
  const lines: string[] = [
    "// tailor-env.d.ts (auto-generated by @tailor-platform/sdk/ts-plugin)",
    "// Do not edit this file manually.",
    "",
    'import type { InferTable } from "@tailor-platform/sdk/kysely";',
    'import type { InferCreateInput, InferUpdateInput, InferGqlResult } from "@tailor-platform/sdk/graphql";',
    "",
  ];

  lines.push(...generateKyselyBlock(manifest, outputDir));

  const gqlBlock = generateGqlBlock(manifest, outputDir);
  if (gqlBlock.length > 0) {
    lines.push("");
    lines.push(...gqlBlock);
  }

  lines.push("");

  return lines.join("\n");
}
