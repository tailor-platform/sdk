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

interface SeedGeneratorOptions {
  distPath: string;
  machineUserName?: string;
}

/**
 * Generates the exec.mjs script content (Node.js executable)
 * @param machineUserName - Machine user name for token retrieval
 * @param relativeConfigPath - Config path relative to exec script
 * @returns exec.mjs file contents
 */
function generateExecScript(machineUserName: string, relativeConfigPath: string): string {
  return ml /* js */ `
    import { execSync } from "node:child_process";
    import { join } from "node:path";
    import { show, getMachineUserToken } from "@tailor-platform/sdk/cli";

    const configDir = import.meta.dirname;
    const configPath = join(configDir, "${relativeConfigPath}");

    console.log("Starting seed data generation...");

    const appInfo = await show({ configPath });
    const endpoint = \`\${appInfo.url}/query\`;

    const tokenInfo = await getMachineUserToken({ name: "${machineUserName}", configPath });
    const headers = JSON.stringify({ Authorization: \`Bearer \${tokenInfo.accessToken}\` });

    const headersArg = process.platform === "win32"
      ? \`"\${headers.replace(/"/g, '\\\\"')}"\`
      : \`'\${headers}'\`;

    const cmd = \`npx gql-ingest -c "\${configDir}" -e "\${endpoint}" --headers \${headersArg}\`;
    console.log("Running:", cmd);

    try {
      execSync(cmd, { stdio: "inherit" });
    } catch (error) {
      console.error("Seed failed with exit code:", error.status);
      process.exit(error.status ?? 1);
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
