import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/db";

const resolver = createResolver({
  name: "upsertUsers",
  operation: "mutation",
  input: {
    users: t.object({ name: t.string(), email: t.string(), age: t.int() }, { array: true }),
  },
  body: async (context) => {
    const db = getDB("main-db");

    return await db.transaction().execute(async (trx) => {
      let created = 0;
      let updated = 0;

      for (const user of context.input.users) {
        const existing = await trx
          .selectFrom("User")
          .select("id")
          .where("email", "=", user.email)
          .executeTakeFirst();

        if (existing) {
          await trx
            .updateTable("User")
            .set({ name: user.name, age: user.age })
            .where("email", "=", user.email)
            .execute();
          updated++;
        } else {
          await trx.insertInto("User").values(user).execute();
          created++;
        }
      }

      return { created, updated };
    });
  },
  output: t.object({
    created: t.int(),
    updated: t.int(),
  }),
});

export default resolver;
