import { __executor_function } from "../executors/user-created.transformed.js";

const $connect_tailordb = async (namespace) => {
  const baseClient = new tailordb.Client({ namespace });
  if (namespace) {
    await baseClient.connect();
  }
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
    }
  };
};

const $tailor_db_wrapper = async (namespace, fn) => {
  const client = await $connect_tailordb(namespace);
  return async (args) => await fn({ ...args, db: client, client });
};
globalThis.main = await $tailor_db_wrapper("tailordb", __executor_function);