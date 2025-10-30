import { createResolver } from "@tailor-platform/tailor-sdk";
import { nestedProfile } from "../tailordb/nested";

export default createResolver({
  name: "passThrough",
  operation: "query",
  input: nestedProfile,
  body: (context) => context.input,
  output: nestedProfile,
});
