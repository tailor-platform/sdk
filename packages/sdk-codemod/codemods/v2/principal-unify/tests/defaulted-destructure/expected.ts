import { createResolver, t } from "@tailor-platform/sdk";

const fallback = { id: "anon" };

export default createResolver({
  name: "n",
  operation: "query",
  output: t.string(),
  body: ({ caller = fallback }) => caller?.id,
});
