import { createResolver, t } from "@tailor-platform/sdk";

const caller = { id: "outer-caller" };

export default createResolver({
  name: "n",
  operation: "query",
  output: t.string(),
  body: ({ caller: user }) => {
    const parsed = t.string().parse({ value: "hello", data: {}, invoker: user });
    return user?.id ?? caller.id ?? parsed.value;
  },
});
