import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "n",
  operation: "query",
  output: t.string(),
  body: ({ caller }) => {
    const userId = caller.id;
    return userId;
  },
});
