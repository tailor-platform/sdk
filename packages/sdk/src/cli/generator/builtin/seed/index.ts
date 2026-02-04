import ml from "multiline-ts";
import * as path from "pathe";
import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { processGqlIngest } from "./gql-ingest-processor";
import { processIdpUser, generateIdpUserSchemaFile } from "./idp-user-processor";
import {
  processLinesDb,
  generateLinesDbSchemaFile,
  generateLinesDbSchemaFileWithEmbeddedType,
  generateLinesDbSchemaFileWithMultipleTypes,
  generatePluginTypeDefinition,
  type GroupedTypeMetadata,
} from "./lines-db-processor";
import type { SeedTypeMetadata } from "./types";

export const SeedGeneratorID = "@tailor-platform/seed";

type SeedGeneratorOptions = {
  distPath: string;
  machineUserName?: string;
};

/**
 * Generates the exec.mjs script content (Node.js executable) using gql-ingest Programmatic API
 * @param machineUserName - Machine user name for token retrieval
 * @param relativeConfigPath - Config path relative to exec script
 * @param entityDependencies - Entity dependencies mapping
 * @returns exec.mjs file contents
 */
function generateExecScript(
  machineUserName: string,
  relativeConfigPath: string,
  entityDependencies: Record<string, { namespace?: string; dependencies: string[] }>,
): string {
  // Generate namespaceEntities and entityDependenciesObject
  const namespaceMap = new Map<string, string[]>();
  for (const [type, meta] of Object.entries(entityDependencies)) {
    if (meta.namespace) {
      if (!namespaceMap.has(meta.namespace)) {
        namespaceMap.set(meta.namespace, []);
      }
      namespaceMap.get(meta.namespace)!.push(type);
    }
  }

  const namespaceEntitiesEntries = Array.from(namespaceMap.entries())
    .map(([namespace, entities]) => {
      const entitiesFormatted = entities.map((e) => `        "${e}",`).join("\n");
      return `      ${namespace}: [\n${entitiesFormatted}\n      ]`;
    })
    .join(",\n");

  return ml /* js */ `
    import { GQLIngest } from "@jackchuka/gql-ingest";
    import { join } from "node:path";
    import { parseArgs, styleText } from "node:util";
    import { createInterface } from "node:readline";
    import { show, getMachineUserToken, truncate } from "@tailor-platform/sdk/cli";

    // Parse command-line arguments
    const { values, positionals } = parseArgs({
      options: {
        namespace: { type: "string", short: "n" },
        "skip-idp": { type: "boolean", default: false },
        truncate: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(\`
    Usage: node exec.mjs [options] [types...]

    Options:
      -n, --namespace <ns> Process all types in specified namespace (excludes _User)
      --skip-idp           Skip IdP user (_User) entity
      --truncate           Truncate tables before seeding
      --yes                Skip confirmation prompts (for truncate)
      -h, --help           Show help

    Examples:
      node exec.mjs                                     # Process all types (default)
      node exec.mjs --namespace <namespace>             # Process tailordb namespace only (no _User)
      node exec.mjs User Order                          # Process specific types only
      node exec.mjs --skip-idp                          # Process all except _User
      node exec.mjs --truncate                          # Truncate all tables, then seed all
      node exec.mjs --truncate --yes                    # Truncate all tables without confirmation, then seed all
      node exec.mjs --truncate --namespace <namespace>  # Truncate tailordb, then seed tailordb
      node exec.mjs --truncate User Order               # Truncate User and Order, then seed them
      \`);
      process.exit(0);
    }

    // Helper function to prompt for y/n confirmation
    const promptConfirmation = (question) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      return new Promise((resolve) => {
        rl.question(styleText("yellow", question), (answer) => {
          rl.close();
          resolve(answer.toLowerCase().trim());
        });
      });
    };

    const configDir = import.meta.dirname;
    const configPath = join(configDir, "${relativeConfigPath}");

    console.log(styleText("cyan", "Starting seed data generation..."));

    // Entity configuration
    const namespaceEntities = {
${namespaceEntitiesEntries}
    };
    const entities = Object.values(namespaceEntities).flat();

    // Determine which entities to process
    let entitiesToProcess = null;

    const hasNamespace = !!values.namespace;
    const hasTypes = positionals.length > 0;
    const skipIdp = values["skip-idp"];

    // Validate mutually exclusive options
    const optionCount = [hasNamespace, hasTypes].filter(Boolean).length;
    if (optionCount > 1) {
      console.error(styleText("red", "Error: Options --namespace and type names are mutually exclusive."));
      process.exit(1);
    }

    // --skip-idp and --namespace are redundant (namespace already excludes _User)
    if (skipIdp && hasNamespace) {
      console.warn(styleText("yellow", "Warning: --skip-idp is redundant with --namespace (namespace filtering already excludes _User)."));
    }

    // Filter by namespace (automatically excludes _User as it has no namespace)
    if (hasNamespace) {
      const namespace = values.namespace;
      entitiesToProcess = namespaceEntities[namespace];

      if (!entitiesToProcess || entitiesToProcess.length === 0) {
        console.error(styleText("red", \`Error: No entities found in namespace "\${namespace}"\`));
        console.error(styleText("yellow", \`Available namespaces: \${Object.keys(namespaceEntities).join(", ")}\`));
        process.exit(1);
      }

      console.log(styleText("cyan", \`Filtering by namespace: \${namespace}\`));
      console.log(styleText("dim", \`Entities: \${entitiesToProcess.join(", ")}\`));
    }

    // Filter by specific types
    if (hasTypes) {
      const requestedTypes = positionals;
      const notFoundTypes = [];

      entitiesToProcess = requestedTypes.filter((type) => {
        if (!entities.includes(type)) {
          notFoundTypes.push(type);
          return false;
        }
        return true;
      });

      if (notFoundTypes.length > 0) {
        console.error(styleText("red", \`Error: The following types were not found: \${notFoundTypes.join(", ")}\`));
        console.error(styleText("yellow", \`Available types: \${entities.join(", ")}\`));
        process.exit(1);
      }

      console.log(styleText("cyan", \`Filtering by types: \${entitiesToProcess.join(", ")}\`));
    }

    // Apply --skip-idp filter
    if (skipIdp) {
      if (entitiesToProcess) {
        // Filter out _User from already filtered list
        entitiesToProcess = entitiesToProcess.filter((entity) => entity !== "_User");
      } else {
        // Get all entities except _User
        entitiesToProcess = entities.filter((entity) => entity !== "_User");
      }
      console.log(styleText("dim", \`Skipping IdP user (_User)\`));
    }

    // Truncate tables if requested
    // Note: --skip-idp only affects seeding, not truncation
    if (values.truncate) {
      // Prompt user for confirmation
      const answer = values.yes ? "y" : await promptConfirmation("Are you sure you want to truncate? (y/n): ");
      if (answer !== "y") {
        console.log(styleText("yellow", "Truncate cancelled."));
        process.exit(0);
      }

      console.log(styleText("cyan", "\\nTruncating tables..."));

      try {
        if (hasNamespace) {
          // Truncate specific namespace
          await truncate({
            configPath,
            namespace: values.namespace,
          });
        } else if (hasTypes) {
          // Truncate specific types
          await truncate({
            configPath,
            types: entitiesToProcess,
          });
        } else {
          // Truncate all (--skip-idp does not affect truncation)
          await truncate({
            configPath,
            all: true,
          });
        }
        console.log(styleText("green", "Truncate completed.\\n"));
      } catch (error) {
        console.error(styleText("red", \`Truncate failed: \${error.message}\`));
        process.exit(1);
      }
    }

    // Get application info and endpoint
    const appInfo = await show({ configPath });
    const endpoint = \`\${appInfo.url}/query\`;

    // Get machine user token
    const tokenInfo = await getMachineUserToken({ name: "${machineUserName}", configPath });

    // Initialize GQLIngest client
    const client = new GQLIngest({
      endpoint,
      headers: {
        Authorization: \`Bearer \${tokenInfo.accessToken}\`,
      },
    });

    // Progress monitoring event handlers
    client.on("started", (payload) => {
      console.log(styleText("cyan", \`Processing \${payload.totalEntities} entities...\`));
    });

    client.on("entityStart", (payload) => {
      console.log(styleText("dim", \`  Processing \${payload.entityName}...\`));
    });

    client.on("entityComplete", (payload) => {
      const { entityName, metrics: { rowsProcessed } } = payload;
      console.log(styleText("green", \`  ✓ \${entityName}: \${rowsProcessed} rows processed\`));
    });

    client.on("rowFailure", (payload) => {
      console.error(styleText("red", \`  ✗ Row \${payload.rowIndex} in \${payload.entityName} failed: \${payload.error.message}\`));
    });

    // Run ingestion
    try {
      let result;
      if (entitiesToProcess && entitiesToProcess.length > 0) {
        result = await client.ingestEntities(configDir, entitiesToProcess);
      } else {
        result = await client.ingest(configDir);
      }

      if (result.success) {
        console.log(styleText("green", "\\n✓ Seed data generation completed successfully"));
        console.log(client.getMetricsSummary());
      } else {
        console.error(styleText("red", "\\n✗ Seed data generation failed"));
        console.error(client.getMetricsSummary());
        process.exit(1);
      }
    } catch (error) {
      console.error(styleText("red", \`\\n✗ Seed data generation failed with error: \${error.message}\`));
      process.exit(1);
    }

    `;
}

/**
 * Type entry for topological sort
 */
interface TypeEntry {
  typeName: string;
  metadata: SeedTypeMetadata;
  relationTargets: string[];
}

/**
 * Topological sort of types based on relation dependencies.
 * Types that are depended on (relation targets) come first.
 * @param types - Array of type entries
 * @param groupTypeNames - Set of type names in the group for filtering
 * @returns Sorted array of type entries (dependencies first)
 */
function topologicalSort(types: TypeEntry[], groupTypeNames: Set<string>): TypeEntry[] {
  const typeMap = new Map<string, TypeEntry>();
  for (const t of types) {
    typeMap.set(t.typeName, t);
  }

  const visited = new Set<string>();
  const result: TypeEntry[] = [];

  const visit = (typeName: string) => {
    if (visited.has(typeName)) return;
    visited.add(typeName);

    const entry = typeMap.get(typeName);
    if (!entry) return;

    // Visit dependencies first (types that this type references)
    for (const target of entry.relationTargets) {
      if (groupTypeNames.has(target)) {
        visit(target);
      }
    }

    result.push(entry);
  };

  // Visit all types
  for (const t of types) {
    visit(t.typeName);
  }

  return result;
}

/**
 * Find all types that a given type depends on (directly or transitively).
 * @param typeName - The type to find dependencies for
 * @param sortedTypes - All types in dependency order
 * @param groupTypeNames - Set of type names in the group for filtering
 * @returns Array of dependency type names (not including the type itself)
 */
function findDependencies(
  typeName: string,
  sortedTypes: TypeEntry[],
  groupTypeNames: Set<string>,
): string[] {
  const typeMap = new Map<string, TypeEntry>();
  for (const t of sortedTypes) {
    typeMap.set(t.typeName, t);
  }

  const dependencies = new Set<string>();

  const collectDeps = (name: string) => {
    const entry = typeMap.get(name);
    if (!entry) return;

    for (const target of entry.relationTargets) {
      if (groupTypeNames.has(target) && target !== typeName && !dependencies.has(target)) {
        dependencies.add(target);
        collectDeps(target);
      }
    }
  };

  collectDeps(typeName);
  return Array.from(dependencies);
}

/**
 * Factory function to create a Seed generator.
 * Combines GraphQL Ingest and lines-db schema generation.
 * @param options - Seed generator options
 * @returns Seed generator
 */
export function createSeedGenerator(
  options: SeedGeneratorOptions,
): TailorDBGenerator<SeedTypeMetadata, Record<string, SeedTypeMetadata>> {
  return {
    id: SeedGeneratorID,
    description: "Generates seed data files (GraphQL Ingest + lines-db schema)",
    dependencies: ["tailordb"] as const,

    processType: ({ type, source, namespace }) => {
      const gqlIngest = processGqlIngest(type, namespace);
      const linesDb = processLinesDb(type, source);
      // Generate type definition for plugin-generated types (to embed in schema file)
      const pluginTypeDefinition = source.pluginId ? generatePluginTypeDefinition(type) : undefined;
      // Collect relation targets for dependency resolution
      const relationTargets = Object.values(type.forwardRelationships)
        .map((rel) => rel.targetType)
        .filter((target) => target !== type.name); // Exclude self-references
      return {
        gqlIngest,
        linesDb,
        pluginTypeDefinition,
        relationTargets: relationTargets.length > 0 ? relationTargets : undefined,
      };
    },

    processTailorDBNamespace: ({ types }) => types,

    aggregate: ({
      input,
      configPath,
    }: AggregateArgs<TailorDBInput<Record<string, SeedTypeMetadata>>>) => {
      const entityDependencies: Record<
        /* outputDir */ string,
        Record</* type */ string, { namespace?: string; dependencies: string[] }>
      > = {};

      const files: GeneratorResult["files"] = [];

      // Group plugin-generated types by their source for combined schema generation
      // Key: pluginId + originalFilePath, Value: array of types from that source
      const pluginTypeGroups = new Map<
        string,
        {
          typeName: string;
          metadata: SeedTypeMetadata;
          relationTargets: string[];
        }[]
      >();

      // All plugin-generated type names for reference
      const allPluginTypeNames = new Set<string>();

      for (const nsResult of input.tailordb) {
        if (!nsResult.types) continue;

        const outputBaseDir = options.distPath;
        if (!(outputBaseDir in entityDependencies)) {
          entityDependencies[outputBaseDir] = {};
        }

        for (const [_typeName, metadata] of Object.entries(nsResult.types)) {
          const { gqlIngest, linesDb, pluginTypeDefinition, relationTargets } = metadata;

          entityDependencies[outputBaseDir][gqlIngest.name] = {
            namespace: gqlIngest.namespace,
            dependencies: gqlIngest.dependencies,
          };

          // Generate GraphQL Ingest files
          files.push(
            {
              path: path.join(outputBaseDir, "mappings", `${gqlIngest.name}.json`),
              content: JSON.stringify(gqlIngest.mapping, null, 2) + "\n",
            },
            {
              path: path.join(outputBaseDir, gqlIngest.mapping.dataFile),
              content: "",
              skipIfExists: true,
            },
            {
              path: path.join(outputBaseDir, gqlIngest.mapping.graphqlFile),
              content: gqlIngest.graphql,
            },
          );

          // Collect plugin-generated types for grouping
          if (pluginTypeDefinition && linesDb.pluginSource) {
            const groupKey = `${linesDb.pluginSource.pluginId}:${linesDb.pluginSource.originalFilePath}`;
            if (!pluginTypeGroups.has(groupKey)) {
              pluginTypeGroups.set(groupKey, []);
            }
            pluginTypeGroups.get(groupKey)!.push({
              typeName: linesDb.typeName,
              metadata,
              relationTargets: relationTargets || [],
            });
            allPluginTypeNames.add(linesDb.typeName);
          } else {
            // User-defined type: generate individual schema file
            const schemaOutputPath = path.join(
              outputBaseDir,
              "data",
              `${linesDb.typeName}.schema.ts`,
            );
            const relativePath = path.relative(path.dirname(schemaOutputPath), linesDb.importPath);
            const typeImportPath = relativePath.replace(/\.ts$/, "").startsWith(".")
              ? relativePath.replace(/\.ts$/, "")
              : `./${relativePath.replace(/\.ts$/, "")}`;
            const schemaContent = generateLinesDbSchemaFile(linesDb, typeImportPath);

            files.push({
              path: schemaOutputPath,
              content: schemaContent,
            });
          }
        }
      }

      // Generate schema files for plugin-generated types
      // Types with inter-type relations are grouped into a single file
      const outputBaseDir = options.distPath;
      for (const [_groupKey, groupTypes] of pluginTypeGroups) {
        // Filter relation targets to only include types within the same plugin group
        const groupTypeNames = new Set(groupTypes.map((t) => t.typeName));

        // Check if any type in the group has relations to other types in the same group
        const hasInternalRelations = groupTypes.some((t) =>
          t.relationTargets.some((target) => groupTypeNames.has(target)),
        );

        if (hasInternalRelations && groupTypes.length > 1) {
          // Sort types by dependency order (types that are relation targets come first)
          const sortedTypes = topologicalSort(groupTypes, groupTypeNames);

          // Generate a combined schema file for each type (each type gets its own file,
          // but includes all dependency type definitions)
          for (const typeEntry of sortedTypes) {
            const { typeName, metadata } = typeEntry;

            // Find all types that this type depends on (directly or indirectly)
            const dependencyTypes = findDependencies(typeName, sortedTypes, groupTypeNames);

            // Include the type itself and its dependencies
            const typesToInclude: GroupedTypeMetadata[] = [];
            for (const depType of dependencyTypes) {
              const depEntry = sortedTypes.find((t) => t.typeName === depType);
              if (depEntry && depEntry.metadata.pluginTypeDefinition) {
                typesToInclude.push({
                  metadata: depEntry.metadata.linesDb,
                  typeDefinition: depEntry.metadata.pluginTypeDefinition,
                });
              }
            }
            // Add the main type itself
            if (metadata.pluginTypeDefinition) {
              typesToInclude.push({
                metadata: metadata.linesDb,
                typeDefinition: metadata.pluginTypeDefinition,
              });
            }

            const schemaOutputPath = path.join(outputBaseDir, "data", `${typeName}.schema.ts`);
            const schemaContent = generateLinesDbSchemaFileWithMultipleTypes(
              typesToInclude,
              typeName,
            );

            files.push({
              path: schemaOutputPath,
              content: schemaContent,
            });
          }
        } else {
          // No internal relations or single type: generate individual schema files
          for (const { typeName, metadata } of groupTypes) {
            if (metadata.pluginTypeDefinition) {
              const schemaOutputPath = path.join(outputBaseDir, "data", `${typeName}.schema.ts`);
              const schemaContent = generateLinesDbSchemaFileWithEmbeddedType(
                metadata.linesDb,
                metadata.pluginTypeDefinition,
              );

              files.push({
                path: schemaOutputPath,
                content: schemaContent,
              });
            }
          }
        }
      }

      // Generate IdP user files if BuiltInIdP is configured
      if (input.auth) {
        const idpUser = processIdpUser(input.auth);
        if (idpUser) {
          const outputBaseDir = options.distPath;
          if (!(outputBaseDir in entityDependencies)) {
            entityDependencies[outputBaseDir] = {};
          }

          // Add _User to entityDependencies (without namespace as IdP user doesn't have one)
          entityDependencies[outputBaseDir][idpUser.name] = {
            dependencies: idpUser.dependencies,
          };

          // Generate GraphQL mutation file
          files.push({
            path: path.join(outputBaseDir, idpUser.mapping.graphqlFile),
            content: idpUser.graphql,
          });

          // Generate mapping file
          files.push({
            path: path.join(outputBaseDir, "mappings", `${idpUser.name}.json`),
            content: JSON.stringify(idpUser.mapping, null, 2) + "\n",
          });

          // Generate empty JSONL data file
          files.push({
            path: path.join(outputBaseDir, idpUser.mapping.dataFile),
            content: "",
            skipIfExists: true,
          });

          // Generate schema file with foreign key
          files.push({
            path: path.join(outputBaseDir, "data", `${idpUser.name}.schema.ts`),
            content: generateIdpUserSchemaFile(
              idpUser.schema.usernameField,
              idpUser.schema.userTypeName,
            ),
          });
        }
      }

      for (const [outputDir, dependencies] of Object.entries(entityDependencies)) {
        files.push({
          path: path.join(outputDir, "config.yaml"),
          content: /* yaml */ `entityDependencies:
  ${Object.entries(dependencies)
    .map(([type, deps]) => `${type}: [${deps.dependencies.join(", ")}]`)
    .join("\n  ")}
`,
        });

        // Generate exec.mjs if machineUserName is provided
        if (options.machineUserName) {
          const relativeConfigPath = path.relative(outputDir, configPath);
          files.push({
            path: path.join(outputDir, "exec.mjs"),
            content: generateExecScript(options.machineUserName, relativeConfigPath, dependencies),
          });
        }
      }

      return { files };
    },
  };
}
