import { createResolver as makeResolver, t } from "@tailor-platform/sdk";

export default makeResolver({
  name: "n",
  operation: "query",
  output: t.string(),
  body: ({ caller }) => caller.id,
});
