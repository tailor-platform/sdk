import * as path from "node:path";
import {
  type CodeGenerator,
  type GeneratorResult,
} from "@/cli/generator/types";
import { processGqlIngest } from "./gql-ingest-processor";
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
export function createSeedGenerator(options: {
  distPath: string;
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

    aggregate: ({ inputs }) => {
      const entityDependencies: Record<
        /* outputDir */ string,
        Record</* type */ string, /* dependencies */ string[]>
      > = {};

      const files: GeneratorResult["files"] = [];

      for (const input of inputs) {
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
      }

      return { files };
    },
  };
}
