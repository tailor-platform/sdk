import { createResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
import { nestedProfile } from "../tailordb/nested";

const inputFields = {
  ...nestedProfile.pickFields(["id", "createdAt"], { optional: true }),
  ...nestedProfile.omitFields(["id", "createdAt"]),
};
export default createResolver({
  operation: "query",
  name: "passThrough",
  description: "Pass Through - Nested Profile Type(Create)",
  input: {
    id: t.uuid({ optional: true }),
    input: t.object(inputFields),
  },
  body: ({ input }) => ({
    ...input.input,
    id: input.id ?? crypto.randomUUID(),
    createdAt: format(new Date(), "yyyy-MM-dd HH:mm:ss"),
  }),
  output: t.object(nestedProfile.fields),
});
