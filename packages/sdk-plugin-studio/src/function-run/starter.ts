export const STARTER_CODE = `import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "add",
  operation: "query",
  permission: "allowAnonymous",
  input: {
    a: t.int(),
    b: t.int(),
  },
  body: ({ input }) => input.a + input.b,
  output: t.int(),
});
`;
