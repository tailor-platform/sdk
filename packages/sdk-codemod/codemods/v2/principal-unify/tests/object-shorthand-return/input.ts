import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "n",
  operation: "query",
  output: t.object({ user: t.string() }),
  body: ({ user }) => ({ user }),
});
