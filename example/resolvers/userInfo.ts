import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "showUserInfo",
  description: "Show current user and invoker information",
  operation: "query",
  body: (context) => {
    return {
      caller: {
        id: context.caller?.id ?? "",
        type: context.caller?.type ?? "",
        workspaceId: context.caller?.workspaceId ?? "",
        role: context.caller?.attributes.role ?? "MANAGER",
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
      caller: t
        .object({
          id: t.string().description("User ID"),
          type: t.string().description("User type"),
          workspaceId: t.string().description("Workspace ID"),
          role: t.enum(["MANAGER", "STAFF"]).description("User role"),
        })
        .description("Authenticated caller"),
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
  invoker: "manager-machine-user",
});
