import { createResolver, t } from "@tailor-platform/sdk";

const resolver = createResolver({
  name: "showUserInfo",
  description: "Returns information about the current user",
  operation: "query",
  body: (context) => {
    return {
      userId: context.caller?.id ?? "anonymous",
      userType: context.caller?.type ?? "anonymous",
      workspaceId: context.caller?.workspaceId ?? "",
    };
  },
  output: t.object({
    userId: t.string(),
    userType: t.string(),
    workspaceId: t.string(),
  }),
});

export default resolver;
