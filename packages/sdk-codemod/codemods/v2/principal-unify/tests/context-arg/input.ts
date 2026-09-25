import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "show",
  operation: "query",
  output: t.object({ id: t.string(), type: t.string() }),
  body: (ctx) => ({
    id: ctx.user.id,
    type: ctx.user.type,
  }),
});
