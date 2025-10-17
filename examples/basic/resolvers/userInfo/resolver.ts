import { createResolver, t } from "@tailor-platform/tailor-sdk";

export default createResolver({
  name: "showUserInfo",
  operation: "query",
  body: (context) => {
    return {
      id: context.user.id,
      type: context.user.type,
      workspaceId: context.user.workspaceId,
      role: context.user.attributes?.role ?? "MANAGER",
    };
  },
  output: t.type({
    id: t.string(),
    type: t.string(),
    workspaceId: t.string(),
    role: t.enum("MANAGER", "STAFF"),
  }),
});
