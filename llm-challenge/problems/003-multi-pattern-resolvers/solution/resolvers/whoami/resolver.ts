import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "whoami",
  operation: "query",
  body: ({ user }) => {
    return {
      userId: user.id,
      userType: user.type,
      attributes: user.attributes,
    };
  },
  output: t.object({
    userId: t.string(),
    userType: t.string(),
    attributes: t.object({}, { optional: true }),
  }),
});
