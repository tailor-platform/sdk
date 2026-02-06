import { createResolver, t } from "@tailor-platform/sdk";
import { buildDraftFields } from "@tailor-platform/sdk/changeset-plugin";
import { getDB } from "../../generated/tailordb";

/**
 * Create a new user draft for approval workflow
 */
export default createResolver({
  name: "createUserDraft",
  description: "Create a new user draft record",
  operation: "mutation",
  input: {
    name: t.string(),
    email: t.string(),
    role: t.enum(["MANAGER", "STAFF"]),
    department: t.string({ optional: true }),
  },
  body: async (context) => {
    const db = getDB("tailordb");
    const { name, email, role, department } = context.input;

    // Build changeset fields using the plugin utility
    const changesetFields = buildDraftFields({
      requestedBy: context.user.id,
    });

    // Insert the draft record
    const result = await db
      .insertInto("User")
      .values({
        name,
        email,
        role,
        department,
        ...changesetFields,
      })
      .returning(["id", "recordId", "recordState"])
      .executeTakeFirstOrThrow();

    return {
      id: result.id,
      recordId: result.recordId,
      recordState: result.recordState,
    };
  },
  output: t.object({
    id: t.string(),
    recordId: t.string(),
    recordState: t.string(),
  }),
});
