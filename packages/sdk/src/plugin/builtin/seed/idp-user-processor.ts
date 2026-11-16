import ml from "#/utils/multiline";
import { SEED_SCHEMA_MODULE } from "./schema-module";
import type { GeneratorAuthInput } from "#/plugin/types";

export interface IdpUserMetadata {
  name: "_User";
  dependencies: string[];
  dataFile: string;
  idpNamespace: string;
  schema: {
    usernameField: string;
    userTableName: string;
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

  const { tableName, usernameField } = auth.userProfile;

  return {
    name: "_User",
    dependencies: [tableName],
    dataFile: "data/_User.jsonl",
    idpNamespace: auth.idProvider.namespace,
    schema: {
      usernameField,
      userTableName: tableName,
    },
  };
}

export const IDP_USER_CONCURRENCY = 16;

const mapWithConcurrencyFunction = ml /* ts */ `
  async function mapWithConcurrency(items, limit, run) {
    const results = new Array(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index], index);
      }
    });
    await Promise.all(lanes);
    return results;
  }
`;

/**
 * Generates the server-side IDP seed script code.
 * Uses the global tailor.idp.Client - no bundling required.
 * @param idpNamespace - The IDP namespace name
 * @returns Script code string
 */
export function generateIdpSeedScriptCode(idpNamespace: string): string {
  return ml /* ts */ `
    ${mapWithConcurrencyFunction}

    export async function main(input) {
      const client = new tailor.idp.Client({ namespace: "${idpNamespace}" });
      const errors = [];
      let processed = 0;
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const upsert = input.upsert === true;
      // Rows may arrive as one chunk of a larger dataset; report row numbers
      // relative to the whole dataset so they match the source JSONL.
      const offset = typeof input.offset === "number" ? input.offset : 0;
      const total = typeof input.total === "number" ? input.total : input.users.length;

      const firstRowByName = new Map();
      const outcomes = new Array(input.users.length);
      const indexes = [];
      input.users.forEach((user, i) => {
        if (firstRowByName.has(user.name)) {
          outcomes[i] = { error: \`duplicate of row \${offset + firstRowByName.get(user.name) + 1}\` };
        } else {
          firstRowByName.set(user.name, i);
          indexes.push(i);
        }
      });

      await mapWithConcurrency(indexes, ${String(IDP_USER_CONCURRENCY)}, async (i) => {
        try {
          const { initialPassword, ...row } = input.users[i];
          const createInput =
            initialPassword === undefined || row.password !== undefined
              ? row
              : { ...row, password: initialPassword };
          let status = "created";
          if (upsert) {
            let existing;
            let lookupError;
            try {
              existing = await client.userByName(row.name);
            } catch (error) {
              existing = undefined;
              lookupError = error instanceof Error ? error.message : String(error);
            }

            if (existing) {
              const { name, ...attributes } = row;
              if (Object.keys(attributes).length === 0) {
                status = "skipped";
              } else {
                await client.updateUser({ id: existing.id, ...attributes });
                status = "updated";
              }
            } else {
              try {
                await client.createUser(createInput);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                  lookupError ? \`create failed (\${message}); lookup failed (\${lookupError})\` : message,
                );
              }
            }
          } else {
            await client.createUser(createInput);
          }
          outcomes[i] = { status };
          console.log(\`[_User] \${offset + i + 1}/\${total}: \${input.users[i].name}\`);
        } catch (error) {
          outcomes[i] = { error: error instanceof Error ? error.message : String(error) };
        }
      });

      outcomes.forEach((outcome, i) => {
        if (outcome.error !== undefined) {
          errors.push(\`Row \${offset + i + 1} (\${input.users[i].name}): \${outcome.error}\`);
          console.error(\`[_User] Row \${offset + i + 1} failed: \${outcome.error}\`);
          return;
        }
        processed++;
        if (outcome.status === "created") created++;
        else if (outcome.status === "updated") updated++;
        else skipped++;
      });

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

const listIdpUsersFunction = ml /* ts */ `
  async function listUsers(client) {
    let after = undefined;
    const users = [];
    do {
      const response = await client.users(after ? { after } : undefined);
      for (const user of response.users || []) {
        users.push({ id: user.id, name: user.name });
      }
      after = response.nextPageToken;
    } while (after);
    console.log(\`Found \${users.length} IDP users to delete\`);
    return users;
  }
`;

/**
 * Generates the server-side script that lists every IdP user for truncation.
 * @param idpNamespace - The IDP namespace name
 * @returns Script code string
 */
export function generateIdpListUsersScriptCode(idpNamespace: string): string {
  return ml /* ts */ `
    ${listIdpUsersFunction}

    export async function main() {
      const client = new tailor.idp.Client({ namespace: "${idpNamespace}" });
      const users = await listUsers(client);
      return { success: true, users };
    }
  `;
}

/**
 * Generates the server-side IDP truncation script code.
 * Deletes the users passed in `input.users` (one chunk of the listing produced by
 * {@link generateIdpListUsersScriptCode}), or every user when no chunk is passed so
 * older seed plugins that call it without input keep working. A user that is already
 * gone counts as deleted.
 * @param idpNamespace - The IDP namespace name
 * @returns Script code string
 */
export function generateIdpTruncateScriptCode(idpNamespace: string): string {
  return ml /* ts */ `
    ${listIdpUsersFunction}
    ${mapWithConcurrencyFunction}

    export async function main(input) {
      const client = new tailor.idp.Client({ namespace: "${idpNamespace}" });
      const errors = [];
      let deleted = 0;
      let notFound = 0;
      const users = Array.isArray(input.users) ? input.users : await listUsers(client);
      const offset = typeof input.offset === "number" ? input.offset : 0;
      const total = typeof input.total === "number" ? input.total : users.length;

      const outcomes = await mapWithConcurrency(users, ${String(IDP_USER_CONCURRENCY)}, async (user, i) => {
        try {
          await client.deleteUser(user.id);
          console.log(\`[_User] Deleted \${offset + i + 1}/\${total}: \${user.name}\`);
          return { status: "deleted" };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/user not found/i.test(message)) {
            console.log(\`[_User] Already deleted \${offset + i + 1}/\${total}: \${user.name}\`);
            return { status: "notFound" };
          }
          console.error(\`[_User] Delete failed for \${user.name}: \${message}\`);
          return { error: \`User \${user.id} (\${user.name}): \${message}\` };
        }
      });
      for (const outcome of outcomes) {
        if (outcome.error !== undefined) errors.push(outcome.error);
        else if (outcome.status === "deleted") deleted++;
        else notFound++;
      }

      return {
        success: errors.length === 0,
        deleted,
        notFound,
        total: users.length,
        errors,
      };
    }
  `;
}

type GenerateIdpUserSchemaFileOptions = {
  usernameField: string;
  userTableName: string;
  /**
   * When `true` (default), emit a foreign key from `_User.name` to the
   * userProfile table's username field so that seed validation rejects `_User`
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
 * @param options.userTableName - TailorDB user table name
 * @param options.includeUserProfileFK - Whether to emit the `_User -> userProfile` foreign key (default `true`)
 * @returns Schema file contents
 */
export function generateIdpUserSchemaFile(options: GenerateIdpUserSchemaFileOptions): string {
  const { usernameField, userTableName, includeUserProfileFK = true } = options;
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
            table: "${userTableName}",
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
    import { defineSchema, fillIdpUserPassword } from "${SEED_SCHEMA_MODULE}";
    import { createStandardSchema } from "@tailor-platform/sdk/test";

    const schemaType = t.object({
      name: t.string(),
      password: t.string(),
    });

    export const hook = <T>(data: unknown) => fillIdpUserPassword(data) as T;

    export const schema = defineSchema(
      createStandardSchema(schemaType, hook),
      {
        ${schemaBody}
      }
    );

    `;
}
