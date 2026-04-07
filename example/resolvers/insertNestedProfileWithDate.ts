import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "insertNestedProfileWithDate",
  description: "Insert a NestedProfile with Date in nested object and verify round-trip",
  operation: "mutation",
  input: {
    name: t.string().description("User's name"),
    email: t.string().description("User's email"),
  },
  output: t
    .object({
      id: t.string(),
      metadataCreated: t.datetime(),
    })
    .description("Inserted profile ID and metadata.created value from select"),
  body: async ({ input }) => {
    const db = getDB("tailordb");

    // Insert with Date object in nested field
    const inserted = await db
      .insertInto("NestedProfile")
      .values({
        userInfo: {
          name: input.name,
          email: input.email,
        },
        metadata: [
          {
            created: new Date(),
            version: 1,
          },
        ],
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Read back to verify the nested datetime was stored and returned correctly
    const selected = await db
      .selectFrom("NestedProfile")
      .selectAll()
      .where("id", "=", inserted.id)
      .executeTakeFirstOrThrow();

    console.log(`typeof metadata[0].created: ${typeof selected.metadata[0].created}`);

    return {
      id: selected.id,
      metadataCreated: selected.metadata[0].created,
    };
  },
});
