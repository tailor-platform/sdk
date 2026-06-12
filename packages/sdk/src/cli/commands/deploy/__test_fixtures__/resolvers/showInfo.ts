import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "showInfo",
  description: "Show current user information",
  operation: "query",
  body: (context) => {
    return {
      id: context.user.id,
      type: context.user.type,
      workspaceId: context.user.workspaceId,
      // platform response may omit the field
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      role: (context.user.attributes?.role as string) ?? "ADMIN",
    };
  },
  output: t
    .object({
      id: t.string().description("User ID"),
      type: t.string().description("User type"),
      workspaceId: t.string().description("Workspace ID"),
      role: t.string().description("User role"),
    })
    .description("User information"),
});
