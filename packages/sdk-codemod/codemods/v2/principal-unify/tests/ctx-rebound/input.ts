import { createResolver, t } from "@tailor-platform/sdk";

declare function getOther(): { user: { id: string } };

export default createResolver({
  name: "n",
  operation: "query",
  output: t.string(),
  body: (ctx) => {
    var ctx = getOther();
    return ctx.user.id;
  },
});
