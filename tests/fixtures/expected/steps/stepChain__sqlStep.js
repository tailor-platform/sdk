import { $tailor_resolver_step__sqlStep } from "../resolvers/stepChain.transformed.js";

const $connect_tailordb = async (namespace) => {
  const baseClient = new tailordb.Client({ namespace });
  await baseClient.connect();
  const client = {
    async exec(query) {
      const result = await baseClient.queryObject(query);
      return result.rows;
    },
    async execOne(query) {
      const result = await baseClient.queryObject(query);
      console.log(result);
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

const $tailor_sql_step_wrapper = async (namespace, fn) => {
  const client = await $connect_tailordb(namespace);
  return async (args) => await fn({ ...args, client });
};
globalThis.main = await $tailor_sql_step_wrapper("my-db", $tailor_resolver_step__sqlStep);