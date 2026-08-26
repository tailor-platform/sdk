import { createResolver, t } from "@tailor-platform/sdk";

const items: Array<{ user: { id: string } }> = [];

export default createResolver({
  name: "n",
  operation: "query",
  output: t.array(t.string()),
  body: (ctx) => ({
    me: ctx.caller?.id,
    others: items.map((ctx) => ctx.user.id),
  }),
});
