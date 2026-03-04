import { createResolver, t } from "@tailor-platform/sdk";

const resolver = createResolver({
  name: "showUserInfo",
  description: "Returns information about the current user",
  operation: "query",
  body: (context) => {
    return {
      userId: context.user.id,
      userType: context.user.type,
      workspaceId: context.user.workspaceId,
    };
  },
  output: t.object({
    userId: t.string(),
    userType: t.string(),
    workspaceId: t.string(),
  }),
});

export default resolver;
