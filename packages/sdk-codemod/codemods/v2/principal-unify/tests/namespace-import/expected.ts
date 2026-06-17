import * as sdk from "@tailor-platform/sdk";

type User = sdk.TailorPrincipal;

const role = sdk.db.string().hooks({
  create: ({ invoker }: { invoker: sdk.TailorPrincipal | null }) => invoker?.id ?? "anonymous",
});

export default sdk.createResolver({
  name: "n",
  operation: "query",
  output: sdk.t.string(),
  body: ({ caller }) => {
    const parsed = sdk.t.string().parse({ value: "hello", data: {}, invoker: caller });
    return caller?.id ?? parsed.value;
  },
});

export const helper = (u: User) => role.parse({ value: u.id, data: {}, invoker: null });
