import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";

export default createQueryResolver("showUserInfo")
  .fnStep("step1", (context) => {
    return {
      id: context.user.id,
      type: context.user.type,
      workspaceId: context.user.workspaceId,
      role: context.user.attributes?.role ?? "ANON",
    };
  })
  .returns(
    (context) => ({
      id: context.step1.id,
      type: context.step1.type,
      workspaceId: context.step1.workspaceId,
      role: context.step1.role as string,
    }),
    t.type({
      id: t.string(),
      type: t.string(),
      workspaceId: t.string(),
      role: t.string(),
    }),
  );
