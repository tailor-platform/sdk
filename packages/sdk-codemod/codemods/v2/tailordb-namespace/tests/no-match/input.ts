import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "hello",
  type: "Query",
  output: t.string(),
  body: () => "world",
});
