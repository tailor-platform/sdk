import type { GqlIngestMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

/**
 * Processes TailorDB types to generate GraphQL Ingest metadata
 * @param type - Parsed TailorDB type
 * @returns Generated GraphQL Ingest metadata
 */
export function processGqlIngest(type: ParsedTailorDBType): GqlIngestMetadata {
  // Extract dependencies from relations
  const dependencies = Array.from(
    Object.values(type.fields).reduce<Set<string>>((set, field) => {
      if (field.relation?.targetType && field.relation.targetType !== type.name) {
        set.add(field.relation.targetType);
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
