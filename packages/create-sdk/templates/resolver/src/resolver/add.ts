import { createResolver, t } from "@tailor-platform/sdk";

const resolver = createResolver({
  name: "add",
  operation: "query",
  // Overrides the namespace's `defaultPermission`: this resolver reads no
  // data, so anonymous callers are allowed.
  permission: "allowAnonymous",
  input: {
    left: t.int(),
    right: t.int(),
  },
  body: (context) => {
    return context.input.left + context.input.right;
  },
  output: t.int(),
});

export default resolver;
