import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "showInfo",
  description: "Show current user information",
  operation: "query",
  body: (context) => {
    return {
      id: context.caller?.id ?? "",
      type: context.caller?.type ?? "",
      workspaceId: context.caller?.workspaceId ?? "",
      // platform response may omit the field
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      role: (context.caller?.attributes.role as string | undefined) ?? "ADMIN",
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
