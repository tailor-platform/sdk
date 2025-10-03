import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";

export default createQueryResolver(
  "showUserInfo",
  t.type({
    message: t.string(),
  }),
)
  .fnStep("step1", (context) => {
    return {
      message: context.input.message,
      userId: context.user.id,
      userType: context.user.type,
    };
  })
  .returns(
    (context) => ({
      message: context.step1.message,
      userId: context.step1.userId,
      userType: context.step1.userType,
    }),
    t.type({
      message: t.string(),
      userId: t.string(),
      userType: t.string(),
    }),
  );
