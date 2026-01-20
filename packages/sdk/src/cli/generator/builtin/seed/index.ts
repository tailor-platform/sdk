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
 * Converts a path to POSIX format (forward slashes).
 * This ensures consistent import paths across platforms.
 * @param {string} p - Path to convert
 * @returns {string} POSIX-style path
 */
function toPosixPath(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

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
    import { show, getMachineUserToken } from "@tailor-platform/sdk/cli";

    const configDir = import.meta.dirname;
    const configPath = join(configDir, "${relativeConfigPath}");

    console.log("Starting seed data generation...");

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
      const result = await client.ingest(configDir);

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

    processType: ({ type, source }) => {
      const gqlIngest = processGqlIngest(type);
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
        Record</* type */ string, /* dependencies */ string[]>
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

          entityDependencies[outputBaseDir][gqlIngest.name] = gqlIngest.dependencies;

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

          // Add _User to entityDependencies
          entityDependencies[outputBaseDir][idpUser.name] = idpUser.dependencies;

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
    .map(([type, deps]) => `${type}: [${deps.join(", ")}]`)
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
