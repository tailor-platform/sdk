import { createResolver, t } from "@tailor-platform/sdk";

function lookupRole(ctx) {
  return { role: `role-for-${ctx.input.userId}` };
}

export default createResolver({
  name: "lookup-role",
  operation: "query",
  output: t.object({
    role: t.string(),
  }),
  body: lookupRole,
});
