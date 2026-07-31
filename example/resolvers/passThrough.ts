import { createResolver, t } from "@tailor-platform/sdk";
import { nestedProfile } from "../tailordb/nested";

const inputFields = {
  ...nestedProfile.pickFields(["id", "createdAt", "updatedAt"], { optional: true }),
  ...nestedProfile.omitFields(["id", "createdAt", "updatedAt"]),
};
export default createResolver({
  operation: "query",
  name: "passThrough",
  description: "Pass Through - Nested Profile Type(Create)",
  input: {
    id: t.uuid({ optional: true }),
    input: t.object(inputFields),
  },
  body: ({ input }) => {
    const now = new Date();
    return {
      ...input.input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: input.input.createdAt ?? now,
      updatedAt: input.input.updatedAt ?? now,
    };
  },
  output: nestedProfile.fields,
});
