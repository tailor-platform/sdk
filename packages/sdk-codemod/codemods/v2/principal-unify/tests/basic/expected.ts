import { createResolver, t, type TailorPrincipal } from "@tailor-platform/sdk";

export default createResolver({
  name: "getUser",
  operation: "query",
  input: t.object({ id: t.string() }),
  output: t.object({ id: t.string() }),
  body: ({ input, caller }) => {
    const parsed = t.string().parse({ value: input.id, data: {}, invoker: caller });
    return { id: parsed.value ?? caller?.["id"] ?? caller?.id };
  },
});

export const helper = (u: TailorPrincipal) => u.id;
