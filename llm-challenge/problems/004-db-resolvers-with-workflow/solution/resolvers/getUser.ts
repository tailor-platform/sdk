import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "getUser",
  operation: "query",
  input: {
    id: t.string(),
  },
  body: async ({ input }) => {
    const db = getDB("tailordb");
    const user = await db
      .selectFrom("User")
      .select(["name", "email"])
      .where("id", "=", input.id)
      .executeTakeFirstOrThrow();

    return { name: user.name, email: user.email };
  },
  output: t.object({
    name: t.string(),
    email: t.string(),
  }),
});
