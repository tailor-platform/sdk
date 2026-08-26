import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "shadow",
  operation: "query",
  input: t.object({ flag: t.bool() }),
  output: t.object({ id: t.string() }),
  body: ({ input, caller }) => {
    if (input.flag) {
      const user = { id: "fake" };
      return { id: user.id };
    }
    return { id: caller?.id };
  },
});
