import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "showUserInfo",
  description: "Show current user and invoker information",
  operation: "query",
  body: (context) => {
    return {
      user: {
        id: context.user.id,
        type: context.user.type,
        workspaceId: context.user.workspaceId,
        role: context.user.attributes?.role ?? "MANAGER",
      },
      invoker: {
        id: context.invoker!.id,
        type: context.invoker!.type,
        workspaceId: context.invoker!.workspaceId,
        role: context.invoker!.attributes.role,
      },
    };
  },
  output: t
    .object({
      user: t
        .object({
          id: t.string().description("User ID"),
          type: t.string().description("User type"),
          workspaceId: t.string().description("Workspace ID"),
          role: t.enum(["MANAGER", "STAFF"]).description("User role"),
        })
        .description("Authenticated user"),
      invoker: t
        .object({
          id: t.string().description("Invoker ID"),
          type: t.string().description("Invoker type"),
          workspaceId: t.string().description("Workspace ID"),
          role: t.enum(["MANAGER", "STAFF"]).description("Invoker role"),
        })
        .description("Function invoker"),
    })
    .description("User and invoker information"),
  authInvoker: "manager-machine-user",
});
