import { createResolver, t } from "@tailor-platform/sdk";

const caller = { id: "outer-caller" };

export default createResolver({
  name: "n",
  operation: "query",
  output: t.string(),
  body: ({ user }) => {
    const parsed = t.string().parse({ value: "hello", data: {}, user });
    return user.id ?? caller.id ?? parsed.value;
  },
});
