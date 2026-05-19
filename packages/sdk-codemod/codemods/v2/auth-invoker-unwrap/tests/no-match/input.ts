import { createResolver, t } from "@tailor-platform/sdk";

// No `auth.invoker(...)` call here, the codemod should be a no-op.
export default createResolver({
  name: "noop",
  type: "Query",
  input: {},
  body: () => ({ ok: true }),
});
