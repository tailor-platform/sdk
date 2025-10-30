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
  output: t
    .type({
      id: t.string().description("User ID"),
      type: t.string().description("User type"),
      workspaceId: t.string().description("Workspace ID"),
      role: t.enum("MANAGER", "STAFF").description("User role"),
    })
    .description("User information"),
});
