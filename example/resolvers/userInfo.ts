import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "showUserInfo",
  description: "Show current user information",
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
    .object({
      id: t.string().description("User ID"),
      type: t.string().description("User type"),
      workspaceId: t.string().description("Workspace ID"),
      role: t.enum("MANAGER", "STAFF").description("User role"),
    })
    .description("User information"),
});
