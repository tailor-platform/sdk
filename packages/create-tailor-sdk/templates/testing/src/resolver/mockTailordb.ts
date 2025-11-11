import { createResolver, t } from "@tailor-platform/tailor-sdk";
import { getDB } from "../generated/db";

const resolver = createResolver({
  name: "incrementUserAge",
  operation: "mutation",
  input: {
    email: t.string(),
  },
  body: async (context) => {
    // Initialize database client
    const db = getDB("main-db");

    return await db.transaction().execute(async (trx) => {
      // Select current age
      const { age } = await trx
        .selectFrom("User")
        .where("email", "=", context.input.email)
        .select("age")
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Increase age by 1
      const oldAge = age;
      const newAge = age + 1;

      // Update age in database
      await trx
        .updateTable("User")
        .set({ age: newAge })
        .where("email", "=", context.input.email)
        .execute();

      // Return old and new age
      return { oldAge, newAge };
    });
  },
  output: t.object({
    oldAge: t.int(),
    newAge: t.int(),
  }),
});

export default resolver;
