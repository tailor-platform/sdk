import * as path from "node:path";
import ml from "multiline-ts";
import {
  type CodeGenerator,
  type GeneratorResult,
} from "@/cli/generator/types";
import { processGqlIngest } from "./gql-ingest-processor";
import {
  processIdpUser,
  generateIdpUserSchemaFile,
} from "./idp-user-processor";
import {
  processLinesDb,
  generateLinesDbSchemaFile,
} from "./lines-db-processor";
import type { SeedTypeMetadata } from "./types";
import type { Executor } from "@/parser/service/executor";

export const SeedGeneratorID = "@tailor-platform/seed";

/**
 * Factory function to create a Seed generator.
 * Combines GraphQL Ingest and lines-db schema generation.
 */
/**
 * Generates the exec.mjs script content (Node.js executable)
 */
function generateExecScript(
  machineUserName: string,
  relativeConfigPath: string,
): string {
  return ml /* js */ `
    import { execSync } from "node:child_process";
    import { join } from "node:path";
    import { show, machineUserToken } from "@tailor-platform/sdk/cli";

    const configDir = import.meta.dirname;
    const configPath = join(configDir, "${relativeConfigPath}");

    console.log("Starting seed data generation...");

    const appInfo = await show({ configPath });
    const endpoint = \`\${appInfo.url}/query\`;

    const tokenInfo = await machineUserToken({ name: "${machineUserName}", configPath });
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

export function createSeedGenerator(options: {
  distPath: string;
  machineUserName?: string;
}): CodeGenerator<
  SeedTypeMetadata,
  undefined,
  undefined,
  Record<string, SeedTypeMetadata>,
  undefined
> {
  return {
    id: SeedGeneratorID,
    description: "Generates seed data files (GraphQL Ingest + lines-db schema)",

    processType: ({ type, source }) => {
      const gqlIngest = processGqlIngest(type);
      const linesDb = processLinesDb(type, source);
      return { gqlIngest, linesDb };
    },

    processTailorDBNamespace: ({ types }) => types,

    processExecutor: (_executor: Executor) => undefined,

    processResolver: (_args) => undefined,

    aggregate: ({ input, configPath }) => {
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

          entityDependencies[outputBaseDir][gqlIngest.name] =
            gqlIngest.dependencies;

          // Generate GraphQL Ingest files
          files.push(
            {
              path: path.join(
                outputBaseDir,
                "mappings",
                `${gqlIngest.name}.json`,
              ),
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
          const importPath = path.relative(
            path.dirname(schemaOutputPath),
            linesDb.importPath,
          );
          const normalizedImportPath = importPath
            .replace(/\.ts$/, "")
            .startsWith(".")
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
          entityDependencies[outputBaseDir][idpUser.name] =
            idpUser.dependencies;

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
      for (const [outputDir, dependencies] of Object.entries(
        entityDependencies,
      )) {
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
          // Use forward slashes for cross-platform compatibility in the generated script
          const relativeConfigPath = path
            .relative(outputDir, configPath)
            .replaceAll("\\", "/");
          files.push({
            path: path.join(outputDir, "exec.mjs"),
            content: generateExecScript(
              options.machineUserName,
              relativeConfigPath,
            ),
          });
        }
      }

      return { files };
    },
  };
}
