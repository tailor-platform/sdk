import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "helloScriptRef",
  description: "Hello resolver using Function Registry",
  operation: "query",
  input: { name: t.string({ optional: true }) },
  output: t.object({ message: t.string() }),
  scriptRef: "hello",
});
