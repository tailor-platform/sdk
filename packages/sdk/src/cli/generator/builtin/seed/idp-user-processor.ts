import ml from "multiline-ts";
import type { GeneratorAuthInput } from "@/cli/generator/types";

export interface IdpUserMetadata {
  name: "_User";
  dependencies: string[];
  mapping: {
    dataFile: string;
    dataFormat: string;
    graphqlFile: string;
    mapping: { input: "$" };
  };
  graphql: string;
  schema: {
    usernameField: string;
    userTypeName: string;
  };
}

/**
 * Processes auth configuration to generate IdP user seed metadata
 * @param auth - Auth configuration from generator
 * @returns IdP user metadata or undefined if not applicable
 */
export function processIdpUser(auth: GeneratorAuthInput): IdpUserMetadata | undefined {
  // Only process if idProvider is BuiltInIdP and userProfile is defined
  if (auth.idProvider?.kind !== "BuiltInIdP" || !auth.userProfile) {
    return undefined;
  }

  const { typeName, usernameField } = auth.userProfile;

  const graphql = /* gql */ `mutation CreateUser($input: _CreateUserInput!) {
  _createUser(input: $input) {
    id
  }
}
`;

  return {
    name: "_User",
    dependencies: [typeName],
    mapping: {
      dataFile: "data/_User.jsonl",
      dataFormat: "jsonl",
      graphqlFile: "graphql/_User.graphql",
      mapping: { input: "$" },
    },
    graphql,
    schema: {
      usernameField,
      userTypeName: typeName,
    },
  };
}

/**
 * Generates the schema file content for IdP users with foreign key
 * @param usernameField - Username field name
 * @param userTypeName - TailorDB user type name
 * @returns Schema file contents
 */
export function generateIdpUserSchemaFile(usernameField: string, userTypeName: string): string {
  return ml /* ts */ `
    import { t } from "@tailor-platform/sdk";
    import { createStandardSchema } from "@tailor-platform/sdk/test";
    import { defineSchema } from "@toiroakr/lines-db";

    const schemaType = t.object({
      name: t.string(),
      password: t.string(),
    });

    // Simple identity hook for _User (no TailorDB backing type)
    const hook = <T>(data: unknown) => data as T;

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook),
      {
        primaryKey: "name",
        indexes: [
          { name: "_user_name_unique_idx", columns: ["name"], unique: true },
        ],
        foreignKeys: [
          {
            column: "name",
            references: {
              table: "${userTypeName}",
              column: "${usernameField}",
            },
          },
        ],
      }
    );

    `;
}
