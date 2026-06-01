import { createResolver, t, type TailorUser } from "@tailor-platform/sdk";

export default createResolver({
  name: "getUser",
  operation: "query",
  input: t.object({ id: t.string() }),
  output: t.object({ id: t.string() }),
  body: ({ input, user }) => {
    return { id: user.id };
  },
});

export const helper = (u: TailorUser) => u.id;
