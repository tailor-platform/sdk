import ml from "../../../utils/multiline";
import type { GeneratorAuthInput } from "@/types/plugin-generation";

export interface IdpUserMetadata {
  name: "_User";
  dependencies: string[];
  dataFile: string;
  idpNamespace: string;
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

  return {
    name: "_User",
    dependencies: [typeName],
    dataFile: "data/_User.jsonl",
    idpNamespace: auth.idProvider.namespace,
    schema: {
      usernameField,
      userTypeName: typeName,
    },
  };
}

/**
 * Generates the server-side IDP seed script code for testExecScript execution.
 * Uses the global tailor.idp.Client - no bundling required.
 * @param idpNamespace - The IDP namespace name
 * @returns Script code string
 */
export function generateIdpSeedScriptCode(idpNamespace: string): string {
  return ml /* ts */ `
    export async function main(input) {
      const client = new tailor.idp.Client({ namespace: "${idpNamespace}" });
      const errors = [];
      let processed = 0;

      for (let i = 0; i < input.users.length; i++) {
        try {
          await client.createUser(input.users[i]);
          processed++;
          console.log(\`[_User] \${i + 1}/\${input.users.length}: \${input.users[i].name}\`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(\`Row \${i} (\${input.users[i].name}): \${message}\`);
          console.error(\`[_User] Row \${i} failed: \${message}\`);
        }
      }

      return {
        success: errors.length === 0,
        processed,
        errors,
      };
    }
  `;
}

/**
 * Generates the server-side IDP truncation script code for testExecScript execution.
 * Lists all users with pagination and deletes each one.
 * @param idpNamespace - The IDP namespace name
 * @returns Script code string
 */
export function generateIdpTruncateScriptCode(idpNamespace: string): string {
  return ml /* ts */ `
    export async function main() {
      const client = new tailor.idp.Client({ namespace: "${idpNamespace}" });
      const errors = [];
      let deleted = 0;

      // List all users with pagination
      let nextToken = undefined;
      const allUsers = [];
      do {
        const response = await client.users(nextToken ? { nextToken } : undefined);
        allUsers.push(...(response.users || []));
        nextToken = response.nextToken;
      } while (nextToken);

      console.log(\`Found \${allUsers.length} IDP users to delete\`);

      for (const user of allUsers) {
        try {
          await client.deleteUser(user.id);
          deleted++;
          console.log(\`[_User] Deleted \${deleted}/\${allUsers.length}: \${user.name}\`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(\`User \${user.id} (\${user.name}): \${message}\`);
          console.error(\`[_User] Delete failed for \${user.name}: \${message}\`);
        }
      }

      return {
        success: errors.length === 0,
        deleted,
        total: allUsers.length,
        errors,
      };
    }
  `;
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
    import { defineSchema } from "@tailor-platform/sdk/seed";
    import { createStandardSchema } from "@tailor-platform/sdk/test";

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
