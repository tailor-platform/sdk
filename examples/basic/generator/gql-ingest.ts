import path from "node:path";
import type {
  CodeGenerator,
  Executor,
  GeneratorInput,
  GeneratorResult,
} from "@tailor-platform/tailor-sdk/cli";

interface TypeResult {
  app: string;
  name: string;
  dependencies: string[];
  mapping: {
    dataFile: string;
    dataFormat: string;
    graphqlFile: string;
    mapping: { input: "$" };
  };
  graphql: string;
}

export const gqlIngestGenerator: CodeGenerator<
  TypeResult,
  undefined,
  undefined,
  Record<string, TypeResult>,
  undefined
> = {
  id: "gql-ingest",
  description: "generator for gql-ingest",
  processType: ({ type }) => {
    return {
      name: type.name,
      dependencies: Array.from(
        Object.values(type.fields).reduce<Set<string>>((set, field) => {
          if (field.relation?.targetType) {
            set.add(field.relation.targetType);
          }
          return set;
        }, new Set<string>()),
      ),
      mapping: {
        dataFile: `data/${type.name}.jsonl`,
        dataFormat: "jsonl",
        graphqlFile: `graphql/${type.name}.graphql`,
        mapping: { input: "$" },
      },
      graphql: /* gql */ `mutation Create${type.name}($input: ${type.name}CreateInput!) {
  create${type.name}(input: $input) {
    id
  }
}
`,
    } as TypeResult;
  },
  processTailorDBNamespace({ types }: { types: Record<string, TypeResult> }) {
    return types;
  },
  processExecutor: (_executor: Executor) => undefined,
  processResolver: (_args) => undefined,
  aggregate({
    inputs,
  }: {
    inputs: GeneratorInput<Record<string, TypeResult>, undefined>[];
  }): GeneratorResult {
    const entityDependencies: Record<
      /* outputDir */ string,
      Record</* type */ string, /* dependencies */ string[]>
    > = {};
    const files = inputs.flatMap(({ tailordb }) =>
      tailordb.flatMap(({ types }) => {
        const outputBaseDir = "seed";
        if (!(outputBaseDir in entityDependencies)) {
          entityDependencies[outputBaseDir] = {};
        }
        return Object.values(types).flatMap((type) => {
          entityDependencies[outputBaseDir][type.name] = type.dependencies;
          return [
            {
              path: path.join(outputBaseDir, "mappings", `${type.name}.json`),
              content: JSON.stringify(type.mapping, null, 2) + "\n",
            },
            {
              path: path.join(outputBaseDir, type.mapping.dataFile),
              content: "",
              skipIfExists: true,
            },
            {
              path: path.join(outputBaseDir, type.mapping.graphqlFile),
              content: type.graphql,
            },
          ];
        });
      }),
    );

    Object.keys(entityDependencies).forEach((outputDir) => {
      files.push({
        path: path.join(outputDir, "config.yaml"),
        content: /* yaml */ `entityDependencies:
  ${Object.entries(entityDependencies[outputDir])
    .map(([type, deps]) => `${type}: [${deps.join(", ")}]`)
    .join("\n  ")}
`,
      });
    });

    return { files };
  },
};
