import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "lookup-role",
  operation: "query",
  input: {
    userId: t.string(),
  },
  output: t.object({
    role: t.string(),
  }),
  body: (ctx) => ({ role: `role-for-${ctx.input.userId}` }),
});
