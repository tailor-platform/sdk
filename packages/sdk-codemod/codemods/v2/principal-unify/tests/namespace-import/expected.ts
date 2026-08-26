import * as sdk from "@tailor-platform/sdk";

type User = sdk.TailorPrincipal;
type Invokers = (sdk.TailorPrincipal | null)[];

const role = sdk.db.string().hooks({
  create: ({ invoker }: { invoker: sdk.TailorPrincipal | null }) => invoker?.id ?? "anonymous",
});

export const actorTypeValue: (sdk.TailorPrincipal["type"] | undefined) = "user";
export const allowedActorTypes: (sdk.TailorPrincipal["type"] | undefined)[] = [
  "user",
  "machine_user",
];

export function isMachineUser(type: (sdk.TailorPrincipal["type"] | undefined)) {
  return type === "machine_user";
}

export function actorFields(actor: sdk.TailorPrincipal | null) {
  return {
    id: actor?.id,
    type: actor?.type,
  };
}

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
export const invokers: Invokers = [];
