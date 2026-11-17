import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "@tailor-platform/sdk/plugin/kysely-type/db";

export default createResolver({
  name: "listUsers",
  description: "List user names with the greeting from env",
  operation: "query",
  invoker: "admin-machine-user",
  body: async ({ env }) => {
    const users = await getDB("main-db")
      .selectFrom("User")
      .select("name")
      .orderBy("name")
      .limit(env.pageSize)
      .execute();
    return {
      greeting: env.greeting,
      names: users.map((user) => user.name),
    };
  },
  output: t.object({
    greeting: t.string(),
    names: t.string({ array: true }),
  }),
});
