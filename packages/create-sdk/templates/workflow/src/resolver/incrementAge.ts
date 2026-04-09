import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/db";

const resolver = createResolver({
  name: "incrementAge",
  description: "Increment age of a user by email",
  operation: "mutation",
  input: {
    email: t.string(),
  },
  body: async (context) => {
    const db = getDB("main-db");

    return await db.transaction().execute(async (trx) => {
      const { age } = await trx
        .selectFrom("User")
        .where("email", "=", context.input.email)
        .select("age")
        .forUpdate()
        .executeTakeFirstOrThrow();

      const oldAge = age;
      const newAge = age + 1;

      await trx
        .updateTable("User")
        .set({ age: newAge })
        .where("email", "=", context.input.email)
        .execute();

      return { oldAge, newAge };
    });
  },
  output: t.object({
    oldAge: t.int(),
    newAge: t.int(),
  }),
});

export default resolver;
