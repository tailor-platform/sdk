import { createResolver, t, type TailorUser } from "@tailor-platform/sdk";

export default createResolver({
  name: "getUser",
  operation: "query",
  input: t.object({ id: t.string() }),
  output: t.object({ id: t.string() }),
  body: ({ input, user }) => {
    const parsed = t.string().parse({ value: input.id, data: {}, user });
    return { id: parsed.value ?? user["id"] ?? user.id };
  },
});

export const helper = (u: TailorUser) => u.id;
