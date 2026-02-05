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

type SeedGeneratorOptions = {
  distPath: string;
  machineUserName?: string;
};

type NamespaceConfig = {
  namespace: string;
  types: string[];
  dependencies: Record<string, string[]>;
};

/**
 * Generate the IdP user seed function code
 * @param hasIdpUser - Whether IdP user is included
 * @returns JavaScript code for IdP user seeding function
 */
function generateIdpUserSeedFunction(hasIdpUser: boolean): string {
  if (!hasIdpUser) return "";

  // Using regular strings with proper escaping to avoid template literal issues
  return `
    // Seed _User via gql-ingest (IdP managed)
    const seedIdpUserViaGqlIngest = async () => {
      console.log(styleText("cyan", "  Seeding _User via GraphQL mutation..."));

      const gqlClient = new GQLIngest({
        endpoint,
        headers: {
          Authorization: \`Bearer \${tokenInfo.accessToken}\`,
        },
      });

      gqlClient.on("entityStart", (payload) => {
        console.log(styleText("dim", \`    Processing \${payload.entityName}...\`));
      });

      gqlClient.on("entityComplete", (payload) => {
        const { entityName, metrics: { rowsProcessed } } = payload;
        console.log(styleText("green", \`  ✓ \${entityName}: \${rowsProcessed} rows processed\`));
      });

      gqlClient.on("rowFailure", (payload) => {
        console.error(styleText("red", \`  ✗ Row \${payload.rowIndex} in \${payload.entityName} failed: \${payload.error.message}\`));
      });

      try {
        const result = await gqlClient.ingestEntities(configDir, ["_User"]);
        return { success: result.success };
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
    `;
}

/**
 * Generate the IdP user seed call code
 * @param hasIdpUser - Whether IdP user is included
 * @returns JavaScript code for calling IdP user seeding
 */
function generateIdpUserSeedCall(hasIdpUser: boolean): string {
  if (!hasIdpUser) return "";

  return `
      // Seed _User if included and not skipped
      const shouldSeedUser = !skipIdp && (!entitiesToProcess || entitiesToProcess.includes("_User"));
      if (hasIdpUser && shouldSeedUser) {
        const result = await seedIdpUserViaGqlIngest();
        if (!result.success) {
          allSuccess = false;
        }
      }
      `;
}

/**
 * Generates the exec.mjs script content using testExecScript API for TailorDB types
 * and gql-ingest for _User (IdP managed)
 * @param machineUserName - Machine user name for token retrieval
 * @param relativeConfigPath - Config path relative to exec script
 * @param namespaceConfigs - Namespace configurations with types and dependencies
 * @param hasIdpUser - Whether _User is included
 * @returns exec.mjs file contents
 */
function generateExecScript(
  machineUserName: string,
  relativeConfigPath: string,
  namespaceConfigs: NamespaceConfig[],
  hasIdpUser: boolean,
): string {
  // Generate namespaceEntities object
  const namespaceEntitiesEntries = namespaceConfigs
    .map(({ namespace, types }) => {
      const entitiesFormatted = types.map((e) => `        "${e}",`).join("\n");
      return `      ${namespace}: [\n${entitiesFormatted}\n      ]`;
    })
    .join(",\n");

  // Generate dependency map for each namespace
  const namespaceDepsEntries = namespaceConfigs
    .map(({ namespace, dependencies }) => {
      const depsObj = Object.entries(dependencies)
        .map(([type, deps]) => `        "${type}": [${deps.map((d) => `"${d}"`).join(", ")}]`)
        .join(",\n");
      return `      "${namespace}": {\n${depsObj}\n      }`;
    })
    .join(",\n");

  // Import statement for gql-ingest (only if _User is included)
  const gqlIngestImport = hasIdpUser ? 'import { GQLIngest } from "@jackchuka/gql-ingest";' : "";

  return ml /* js */ `
    ${gqlIngestImport}
    import { readFileSync, readdirSync, statSync } from "node:fs";
    import { join } from "node:path";
    import { parseArgs, styleText } from "node:util";
    import { createInterface } from "node:readline";
    import {
      show,
      getMachineUserToken,
      truncate,
      bundleSeedScript,
      executeScript,
      initOperatorClient,
      loadAccessToken,
      loadWorkspaceId,
    } from "@tailor-platform/sdk/cli";

    // Parse command-line arguments
    const { values, positionals } = parseArgs({
      options: {
        namespace: { type: "string", short: "n" },
        "skip-idp": { type: "boolean", default: false },
        truncate: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        profile: { type: "string", short: "p" },
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
      -p, --profile <name> Workspace profile name
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
    const namespaceDeps = {
${namespaceDepsEntries}
    };
    const entities = Object.values(namespaceEntities).flat();
    const hasIdpUser = ${String(hasIdpUser)};

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
      const allTypes = hasIdpUser ? [...entities, "_User"] : entities;

      entitiesToProcess = requestedTypes.filter((type) => {
        if (!allTypes.includes(type)) {
          notFoundTypes.push(type);
          return false;
        }
        return true;
      });

      if (notFoundTypes.length > 0) {
        console.error(styleText("red", \`Error: The following types were not found: \${notFoundTypes.join(", ")}\`));
        console.error(styleText("yellow", \`Available types: \${allTypes.join(", ")}\`));
        process.exit(1);
      }

      console.log(styleText("cyan", \`Filtering by types: \${entitiesToProcess.join(", ")}\`));
    }

    // Apply --skip-idp filter
    if (skipIdp) {
      if (entitiesToProcess) {
        entitiesToProcess = entitiesToProcess.filter((entity) => entity !== "_User");
      } else {
        entitiesToProcess = entities.filter((entity) => entity !== "_User");
      }
      console.log(styleText("dim", \`Skipping IdP user (_User)\`));
    }

    // Truncate tables if requested
    if (values.truncate) {
      const answer = values.yes ? "y" : await promptConfirmation("Are you sure you want to truncate? (y/n): ");
      if (answer !== "y") {
        console.log(styleText("yellow", "Truncate cancelled."));
        process.exit(0);
      }

      console.log(styleText("cyan", "\\nTruncating tables..."));

      try {
        if (hasNamespace) {
          await truncate({
            configPath,
            profile: values.profile,
            namespace: values.namespace,
          });
        } else if (hasTypes) {
          await truncate({
            configPath,
            profile: values.profile,
            types: entitiesToProcess.filter((t) => t !== "_User"),
          });
        } else {
          await truncate({
            configPath,
            profile: values.profile,
            all: true,
          });
        }
        console.log(styleText("green", "Truncate completed.\\n"));
      } catch (error) {
        console.error(styleText("red", \`Truncate failed: \${error.message}\`));
        process.exit(1);
      }
    }

    // Get application info
    const appInfo = await show({ configPath, profile: values.profile });
    const endpoint = \`\${appInfo.url}/query\`;

    // Get machine user token
    const tokenInfo = await getMachineUserToken({
      name: "${machineUserName}",
      configPath,
      profile: values.profile,
    });

    // Load seed data from JSONL files
    const loadSeedData = (dataDir, typeNames) => {
      const data = {};
      for (const typeName of typeNames) {
        const jsonlPath = join(dataDir, \`\${typeName}.jsonl\`);
        try {
          const content = readFileSync(jsonlPath, "utf-8").trim();
          if (content) {
            data[typeName] = content.split("\\n").map((line) => JSON.parse(line));
          } else {
            data[typeName] = [];
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            data[typeName] = [];
          } else {
            throw error;
          }
        }
      }
      return data;
    };

    // Topological sort for dependency order
    const topologicalSort = (types, deps) => {
      const visited = new Set();
      const result = [];

      const visit = (type) => {
        if (visited.has(type)) return;
        visited.add(type);
        const typeDeps = deps[type] || [];
        for (const dep of typeDeps) {
          if (types.includes(dep)) {
            visit(dep);
          }
        }
        result.push(type);
      };

      for (const type of types) {
        visit(type);
      }
      return result;
    };

    // Seed TailorDB types via testExecScript
    const seedViaTestExecScript = async (namespace, typesToSeed, deps) => {
      const dataDir = join(configDir, "data");
      const sortedTypes = topologicalSort(typesToSeed, deps);
      const data = loadSeedData(dataDir, sortedTypes);

      // Skip if no data
      const typesWithData = sortedTypes.filter((t) => data[t] && data[t].length > 0);
      if (typesWithData.length === 0) {
        console.log(styleText("dim", \`  [\${namespace}] No data to seed\`));
        return { success: true, processed: {} };
      }

      console.log(styleText("cyan", \`  [\${namespace}] Seeding \${typesWithData.length} types via Kysely batch insert...\`));

      // Bundle seed script
      const bundled = await bundleSeedScript(namespace, typesWithData);

      // Initialize operator client
      const accessToken = await loadAccessToken({ profile: values.profile, useProfile: true });
      const workspaceId = await loadWorkspaceId({ configPath, profile: values.profile });
      const client = await initOperatorClient(accessToken);

      // Execute seed script
      const result = await executeScript({
        client,
        workspaceId,
        name: \`seed-\${namespace}\`,
        code: bundled.bundledCode,
        arg: JSON.stringify({ data, order: sortedTypes }),
        invoker: {
          namespace,
          machineUserName: "${machineUserName}",
        },
      });

      // Parse result and display logs
      if (result.logs) {
        for (const line of result.logs.split("\\n").filter(Boolean)) {
          console.log(styleText("dim", \`    \${line}\`));
        }
      }

      if (result.success) {
        const parsed = JSON.parse(result.result || "{}");
        for (const [type, count] of Object.entries(parsed.processed || {})) {
          console.log(styleText("green", \`  ✓ \${type}: \${count} rows inserted\`));
        }
        return { success: true, processed: parsed.processed || {} };
      } else {
        console.error(styleText("red", \`  ✗ Seed failed: \${result.error}\`));
        return { success: false, error: result.error };
      }
    };

    ${generateIdpUserSeedFunction(hasIdpUser)}

    // Main execution
    try {
      let allSuccess = true;

      // Determine which namespaces and types to process
      const namespacesToProcess = hasNamespace
        ? [values.namespace]
        : Object.keys(namespaceEntities);

      for (const namespace of namespacesToProcess) {
        const nsTypes = namespaceEntities[namespace] || [];
        const nsDeps = namespaceDeps[namespace] || {};

        // Filter types if specific types requested
        let typesToSeed = entitiesToProcess
          ? nsTypes.filter((t) => entitiesToProcess.includes(t))
          : nsTypes;

        if (typesToSeed.length === 0) continue;

        const result = await seedViaTestExecScript(namespace, typesToSeed, nsDeps);
        if (!result.success) {
          allSuccess = false;
        }
      }

      ${generateIdpUserSeedCall(hasIdpUser)}

      if (allSuccess) {
        console.log(styleText("green", "\\n✓ Seed data generation completed successfully"));
      } else {
        console.error(styleText("red", "\\n✗ Seed data generation completed with errors"));
        process.exit(1);
      }
    } catch (error) {
      console.error(styleText("red", \`\\n✗ Seed data generation failed: \${error.message}\`));
      process.exit(1);
    }

    `;
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
    description: "Generates seed data files (Kysely batch insert + gql-ingest for _User)",
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
      const files: GeneratorResult["files"] = [];

      // Collect namespace configurations
      const namespaceConfigs: NamespaceConfig[] = [];

      for (const nsResult of input.tailordb) {
        if (!nsResult.types) continue;

        const outputBaseDir = options.distPath;
        const types: string[] = [];
        const dependencies: Record<string, string[]> = {};

        for (const [_typeName, metadata] of Object.entries(nsResult.types)) {
          const { gqlIngest, linesDb } = metadata;

          types.push(gqlIngest.name);
          dependencies[gqlIngest.name] = gqlIngest.dependencies;

          // Generate empty JSONL data file
          files.push({
            path: path.join(outputBaseDir, gqlIngest.mapping.dataFile),
            content: "",
            skipIfExists: true,
          });

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

        namespaceConfigs.push({
          namespace: nsResult.namespace,
          types,
          dependencies,
        });
      }

      // Process IdP user if configured
      let hasIdpUser = false;
      if (input.auth) {
        const idpUser = processIdpUser(input.auth);
        if (idpUser) {
          hasIdpUser = true;
          const outputBaseDir = options.distPath;

          // Generate GraphQL mutation file (for gql-ingest)
          files.push({
            path: path.join(outputBaseDir, idpUser.mapping.graphqlFile),
            content: idpUser.graphql,
          });

          // Generate mapping file (for gql-ingest)
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

      // Generate config.yaml with all dependencies
      const allDependencies: Record<string, string[]> = {};
      for (const nsConfig of namespaceConfigs) {
        for (const [type, deps] of Object.entries(nsConfig.dependencies)) {
          allDependencies[type] = deps;
        }
      }

      // Add _User dependencies if exists
      if (input.auth) {
        const idpUser = processIdpUser(input.auth);
        if (idpUser) {
          allDependencies[idpUser.name] = idpUser.dependencies;
        }
      }

      files.push({
        path: path.join(options.distPath, "config.yaml"),
        content: /* yaml */ `entityDependencies:
  ${Object.entries(allDependencies)
    .map(([type, deps]) => `${type}: [${deps.join(", ")}]`)
    .join("\n  ")}
`,
      });

      // Generate exec.mjs if machineUserName is provided
      if (options.machineUserName) {
        const relativeConfigPath = path.relative(options.distPath, configPath);
        files.push({
          path: path.join(options.distPath, "exec.mjs"),
          content: generateExecScript(
            options.machineUserName,
            relativeConfigPath,
            namespaceConfigs,
            hasIdpUser,
          ),
        });
      }

      return { files };
    },
  };
}
