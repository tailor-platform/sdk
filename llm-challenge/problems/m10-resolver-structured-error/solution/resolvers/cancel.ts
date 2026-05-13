import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "cancel",
  operation: "mutation",
  input: {
    id: t.string(),
  },
  body: ({ input }) => {
    if (input.id === "sub-active") {
      return { success: true, error: "" };
    }
    if (input.id === "sub-canceled") {
      return { success: false, error: "Not active" };
    }
    return { success: false, error: "Not found" };
  },
  output: t.object({
    success: t.bool(),
    error: t.string(),
  }),
});
