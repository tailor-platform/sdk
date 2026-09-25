import { createResolver, t } from "@tailor-platform/sdk";
import { secretmanager } from "@tailor-platform/sdk/runtime";

export default createResolver({
  name: "secret",
  description: "Verify Secret Manager values are retrievable at runtime",
  operation: "query",
  body: async () => {
    const value = await secretmanager.getSecret("example-secrets", "sample-token");
    return {
      found: value !== undefined,
      length: value?.length ?? 0,
    };
  },
  output: t.object({
    found: t.bool().description("Whether the secret value was retrieved"),
    length: t.int().description("Length of the retrieved secret value"),
  }),
});
