import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "insertNestedProfileWithDate",
  description: "Create a NestedProfile with Date in nested object",
  operation: "mutation",
  input: {
    name: t.string().description("User's name"),
    email: t.string().description("User's email"),
  },
  output: t.string().description("Created profile ID"),
  body: async ({ input }) => {
    const db = getDB("tailordb");
    const result = await db
      .insertInto("NestedProfile")
      .values({
        userInfo: {
          name: input.name,
          email: input.email,
        },
        metadata: {
          created: new Date(),
          version: 1,
        },
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return result.id;
  },
});
