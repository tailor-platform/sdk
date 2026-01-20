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
import { processLinesDb, generateLinesDbSchemaFile } from "./lines-db-processor";
import type { SeedTypeMetadata } from "./types";

export const SeedGeneratorID = "@tailor-platform/seed";

/**
 * Generates the exec.mjs script content (Node.js executable) using gql-ingest Programmatic API
 * @param {string} machineUserName - Machine user name for token retrieval
 * @param {string} relativeConfigPath - Config path relative to exec script
 * @returns {string} exec.mjs file contents
 */
function generateExecScript(machineUserName: string, relativeConfigPath: string): string {
  return ml /* js */ `
    import { GQLIngest } from "@jackchuka/gql-ingest";
    import { join } from "node:path";
    import { readFileSync } from "node:fs";
    import { parseArgs } from "node:util";
    import { parse } from "yaml";
    import { show, getMachineUserToken } from "@tailor-platform/sdk/cli";

    // Parse command-line arguments
    const { values, positionals } = parseArgs({
      options: {
        namespace: { type: "string", short: "n" },
        "skip-idp": { type: "boolean", default: false },
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
      -h, --help           Show help

    Examples:
      node exec.mjs                       # Process all types (default)
      node exec.mjs --namespace tailordb  # Process tailordb namespace only (no _User)
      node exec.mjs User Order            # Process specific types only
      node exec.mjs --skip-idp            # Process all except _User
      \`);
      process.exit(0);
    }

    const configDir = import.meta.dirname;
    const configPath = join(configDir, "${relativeConfigPath}");

    console.log("Starting seed data generation...");

    // Load config.yaml to get entity-namespace mapping
    const configYamlPath = join(configDir, "config.yaml");
    const configYaml = parse(readFileSync(configYamlPath, "utf-8"));
    const entityNamespaces = configYaml.entityNamespaces || {};
    const entityDependencies = configYaml.entityDependencies || {};

    // Determine which entities to process
    let entitiesToProcess = null;

    const hasNamespace = !!values.namespace;
    const hasTypes = positionals.length > 0;
    const skipIdp = values["skip-idp"];

    // Validate mutually exclusive options
    const optionCount = [hasNamespace, hasTypes].filter(Boolean).length;
    if (optionCount > 1) {
      console.error("Error: Options --namespace and type names are mutually exclusive.");
      process.exit(1);
    }

    // --skip-idp and --namespace are redundant (namespace already excludes _User)
    if (skipIdp && hasNamespace) {
      console.error("Error: --skip-idp is redundant with --namespace (namespace filtering already excludes _User).");
      process.exit(1);
    }

    // Filter by namespace (automatically excludes _User as it has no namespace)
    if (hasNamespace) {
      const namespace = values.namespace;
      entitiesToProcess = Object.keys(entityNamespaces).filter(
        (entity) => entityNamespaces[entity] === namespace
      );

      if (entitiesToProcess.length === 0) {
        console.error(\`Error: No entities found in namespace "\${namespace}"\`);
        console.error(\`Available namespaces: \${[...new Set(Object.values(entityNamespaces))].join(", ")}\`);
        process.exit(1);
      }

      console.log(\`Filtering by namespace: \${namespace}\`);
      console.log(\`Entities: \${entitiesToProcess.join(", ")}\`);
      console.log(\`Note: _User (IdP user) is automatically excluded when filtering by namespace\`);
    }

    // Filter by specific types
    if (hasTypes) {
      const requestedTypes = positionals;
      const notFoundTypes = [];

      entitiesToProcess = requestedTypes.filter((type) => {
        if (!(type in entityDependencies)) {
          notFoundTypes.push(type);
          return false;
        }
        return true;
      });

      if (notFoundTypes.length > 0) {
        console.error(\`Error: The following types were not found: \${notFoundTypes.join(", ")}\`);
        console.error(\`Available types: \${Object.keys(entityDependencies).join(", ")}\`);
        process.exit(1);
      }

      console.log(\`Filtering by types: \${entitiesToProcess.join(", ")}\`);
    }

    // Apply --skip-idp filter
    if (skipIdp) {
      if (entitiesToProcess) {
        // Filter out _User from already filtered list
        entitiesToProcess = entitiesToProcess.filter((entity) => entity !== "_User");
      } else {
        // Get all entities except _User
        entitiesToProcess = Object.keys(entityDependencies).filter((entity) => entity !== "_User");
      }
      console.log(\`Skipping IdP user (_User)\`);
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
      console.log(\`Processing \${payload.totalEntities} entities...\`);
    });

    client.on("entityStart", (payload) => {
      console.log(\`  Processing \${payload.entityName}...\`);
    });

    client.on("entityComplete", (payload) => {
      const { entityName, successCount } = payload;
      console.log(\`  ✓ \${entityName}: \${successCount} rows processed\`);
    });

    client.on("rowFailure", (payload) => {
      console.error(\`  ✗ Row \${payload.rowIndex} in \${payload.entityName} failed: \${payload.error.message}\`);
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
        console.log("\\n✓ Seed data generation completed successfully");
        console.log(client.getMetricsSummary());
      } else {
        console.error("\\n✗ Seed data generation failed");
        console.error(client.getMetricsSummary());
        process.exit(1);
      }
    } catch (error) {
      console.error("\\n✗ Seed data generation failed with error:", error.message);
      process.exit(1);
    }
    `;
}

/**
 * Factory function to create a Seed generator.
 * Combines GraphQL Ingest and lines-db schema generation.
 * @param {{ distPath: string; machineUserName?: string }} options - Seed generator options
 * @param {string} options.distPath - Output directory for generated files
 * @param {string} [options.machineUserName] - Machine user name for seeding
 * @returns {TailorDBGenerator<SeedTypeMetadata, Record<string, SeedTypeMetadata>>} Seed generator
 */
export function createSeedGenerator(options: {
  distPath: string;
  machineUserName?: string;
}): TailorDBGenerator<SeedTypeMetadata, Record<string, SeedTypeMetadata>> {
  return {
    id: SeedGeneratorID,
    description: "Generates seed data files (GraphQL Ingest + lines-db schema)",
    dependencies: ["tailordb"] as const,

    processType: ({ type, source, namespace }) => {
      const gqlIngest = processGqlIngest(type, namespace);
      const linesDb = processLinesDb(type, source);
      return { gqlIngest, linesDb };
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

      for (const nsResult of input.tailordb) {
        if (!nsResult.types) continue;

        const outputBaseDir = options.distPath;
        if (!(outputBaseDir in entityDependencies)) {
          entityDependencies[outputBaseDir] = {};
        }

        for (const [_typeName, metadata] of Object.entries(nsResult.types)) {
          const { gqlIngest, linesDb } = metadata;

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

          // Generate lines-db schema file
          const schemaOutputPath = path.join(
            outputBaseDir,
            "data",
            `${linesDb.typeName}.schema.ts`,
          );
          const importPath = path.relative(path.dirname(schemaOutputPath), linesDb.importPath);
          const normalizedImportPath = importPath.replace(/\.ts$/, "").startsWith(".")
            ? importPath.replace(/\.ts$/, "")
            : `./${importPath.replace(/\.ts$/, "")}`;

          files.push({
            path: schemaOutputPath,
            content: generateLinesDbSchemaFile(linesDb, normalizedImportPath),
          });
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

      // Generate config.yaml for each output directory
      for (const [outputDir, dependencies] of Object.entries(entityDependencies)) {
        files.push({
          path: path.join(outputDir, "config.yaml"),
          content: /* yaml */ `entityDependencies:
  ${Object.entries(dependencies)
    .map(([type, meta]) => `${type}: [${meta.dependencies.join(", ")}]`)
    .join("\n  ")}

entityNamespaces:
  ${Object.entries(dependencies)
    .filter(([_, meta]) => meta.namespace)
    .map(([type, meta]) => `${type}: ${meta.namespace}`)
    .join("\n  ")}
`,
        });

        // Generate exec.mjs if machineUserName is provided
        if (options.machineUserName) {
          const relativeConfigPath = path.relative(outputDir, configPath);
          files.push({
            path: path.join(outputDir, "exec.mjs"),
            content: generateExecScript(options.machineUserName, relativeConfigPath),
          });
        }
      }

      return { files };
    },
  };
}
