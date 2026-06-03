import { createResolver, t } from "@tailor-platform/sdk";

const items: Array<{ id: string }> = [];

export default createResolver({
  name: "n",
  operation: "query",
  output: t.array(t.string()),
  body: ({ caller }) => items.map((user) => user.id),
});
