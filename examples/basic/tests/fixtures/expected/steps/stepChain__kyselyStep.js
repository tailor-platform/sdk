import { $tailor_resolver_step__kyselyStep } from "../resolvers/stepChain.transformed.js";

const $connect_tailordb = async (namespace) => {
  const baseClient = namespace ? new tailordb.Client({ namespace }) : { connect: () => {}, end: () => {} };
  await baseClient.connect();

  const client = {
    async exec(query, params) {
      const result = await baseClient.queryObject(query, params ?? []);
      return result.rows;
    },
    async execOne(query, params) {
      const result = await baseClient.queryObject(query, params ?? []);
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

const $tailor_db_wrapper = async (namespace, fn) => {
  return async (args) => {
    const client = await $connect_tailordb(namespace);
    try {
      return await fn({ ...args, client });
    } finally {
      await client.end();
    }
  };
};
globalThis.main = await $tailor_db_wrapper("tailordb", $tailor_resolver_step__kyselyStep);