import ml from "multiline-ts";

const DB_WRAPPER_NAME = "$tailor_db_wrapper";

export function wrapDbFn(dbNamespace: string, target: string): string {
  return `await ${DB_WRAPPER_NAME}("${dbNamespace}", ${target})`;
}

export const DB_WRAPPER_DEFINITION = ml/* js */ `
  const $connect_tailordb = async (namespace) => {
    const baseClient = namespace ? new tailordb.Client({ namespace }) : { connect: () => {}, end: () => {} };
    await baseClient.connect();

    const client = {
      async exec(query) {
        const result = await baseClient.queryObject(query);
        return result.rows;
      },
      async execOne(query) {
        const result = await baseClient.queryObject(query);
        return result.rows[0];
      },
    };
    return {
      ...client,
      async transaction(callback) {
        try {
          await client.exec("BEGIN");
          const result = await callback(client);
          await client.exec("COMMIT");
          return result;
        } catch (e) {
          console.error("Transaction failed:", e);
          try {
            await client.exec("ROLLBACK");
          } catch (e) {
            console.error("Failed to rollback transaction:", e);
          }
        }
      },
      async end() {
        try {
          await baseClient.end();
        } catch (e) {
          console.error("Error ending connection:", e);
        }
      }
    };
  };

  const ${DB_WRAPPER_NAME} = async (namespace, fn) => {
    return async (args) => {
      const client = await $connect_tailordb(namespace);
      try {
        return await fn({ ...args, client });
      } finally {
        await client.end();
      }
    };
  };
`;
