import ml from "#/utils/multiline";
import type { GeneratorAuthInput } from "#/plugin/types";

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
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const upsert = input.upsert === true;

      for (let i = 0; i < input.users.length; i++) {
        try {
          if (upsert) {
            let existing;
            let lookupError;
            try {
              existing = await client.userByName(input.users[i].name);
            } catch (error) {
              existing = undefined;
              lookupError = error instanceof Error ? error.message : String(error);
            }

            if (existing) {
              const { name, ...attributes } = input.users[i];
              if (Object.keys(attributes).length === 0) {
                skipped++;
              } else {
                await client.updateUser({ id: existing.id, ...attributes });
                updated++;
              }
            } else {
              try {
                await client.createUser(input.users[i]);
                created++;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                  lookupError ? \`create failed (\${message}); lookup failed (\${lookupError})\` : message,
                );
              }
            }
          } else {
            await client.createUser(input.users[i]);
            created++;
          }
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
        created,
        updated,
        skipped,
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
      let after = undefined;
      const allUsers = [];
      do {
        const response = await client.users(after ? { after } : undefined);
        allUsers.push(...(response.users || []));
        after = response.nextPageToken;
      } while (after);

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

type GenerateIdpUserSchemaFileOptions = {
  usernameField: string;
  userTypeName: string;
  /**
   * When `true` (default), emit a foreign key from `_User.name` to the
   * userProfile type's username field so that seed validation rejects `_User`
   * rows without a matching userProfile row. Set to `false` to seed `_User`
   * rows that do not yet have a corresponding userProfile row.
   */
  includeUserProfileFK?: boolean;
};

/**
 * Generates the schema file content for IdP users. Emits the
 * `_User.name -> <userProfile>.<usernameField>` foreign key by default; pass
 * `includeUserProfileFK: false` to omit it (e.g. when seeding `_User` rows
 * that do not yet have a corresponding userProfile row).
 * @param options - Schema generation options
 * @param options.usernameField - Username field name
 * @param options.userTypeName - TailorDB user type name
 * @param options.includeUserProfileFK - Whether to emit the `_User -> userProfile` foreign key (default `true`)
 * @returns Schema file contents
 */
export function generateIdpUserSchemaFile(options: GenerateIdpUserSchemaFileOptions): string {
  const { usernameField, userTypeName, includeUserProfileFK = true } = options;
  const schemaBody = includeUserProfileFK
    ? ml`
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
    `
    : ml`
      primaryKey: "name",
      indexes: [
        { name: "_user_name_unique_idx", columns: ["name"], unique: true },
      ],
    `;

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
        ${schemaBody}
      }
    );

    `;
}
