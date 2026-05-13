import { createResolver, t } from "@tailor-platform/sdk";

// BUG: this free-standing handler has an unannotated `ctx`, so TypeScript
// infers `any` under `strict`. Move the body inside `createResolver(...)` and
// supply an `input` schema so the resolver generic can infer the context.
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
