import type { GqlIngestMetadata } from "./types";
import type { TailorDBType } from "@/parser/service/tailordb/types";

/**
 * Processes TailorDB types to generate GraphQL Ingest metadata
 * @param type - Parsed TailorDB type
 * @param  namespace - Namespace of the type
 * @returns Generated GraphQL Ingest metadata
 */
export function processGqlIngest(type: TailorDBType, namespace: string): GqlIngestMetadata {
  // Extract dependencies from relations (including keyOnly which only sets foreignKeyType)
  const dependencies = Array.from(
    Object.values(type.fields).reduce<Set<string>>((set, field) => {
      const targetType = field.relation?.targetType ?? field.config.foreignKeyType;
      if (targetType && targetType !== type.name) {
        set.add(targetType);
      }
      return set;
    }, new Set<string>()),
  );

  // Generate GraphQL mutation
  const graphql = /* gql */ `mutation Create${type.name}($input: ${type.name}CreateInput!) {
  create${type.name}(input: $input) {
    id
  }
}
`;

  return {
    name: type.name,
    namespace,
    dependencies,
    mapping: {
      dataFile: `data/${type.name}.jsonl`,
      dataFormat: "jsonl",
      graphqlFile: `graphql/${type.name}.graphql`,
      mapping: { input: "$" },
    },
    graphql,
  };
}
