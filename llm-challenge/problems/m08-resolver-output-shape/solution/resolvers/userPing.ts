import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "userPing",
  operation: "query",
  body: () => ({ ok: true }),
  output: t.object({ ok: t.bool() }),
});
