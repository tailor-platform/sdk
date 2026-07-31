import * as sdk from "@tailor-platform/sdk";

type User = sdk.TailorUser;
type Invokers = sdk.TailorInvoker[];

const role = sdk.db.string().hooks({
  create: ({ user }: { user: sdk.TailorUser | null }) => user?.id ?? "anonymous",
});

export const actorTypeValue: sdk.TailorActorType = "USER_TYPE_USER";
export const allowedActorTypes: sdk.TailorActorType[] = [
  "USER_TYPE_USER",
  "USER_TYPE_MACHINE_USER",
];

export function isMachineUser(type: sdk.TailorActorType) {
  return type === "USER_TYPE_MACHINE_USER";
}

export function actorFields(actor: sdk.TailorActor | null) {
  return {
    id: actor?.userId,
    type: actor?.userType,
  };
}

export default sdk.createResolver({
  name: "n",
  operation: "query",
  output: sdk.t.string(),
  body: ({ user }) => {
    const parsed = sdk.t.string().parse({ value: "hello", data: {}, user });
    return user.id ?? parsed.value;
  },
});

export const helper = (u: User) => role.parse({ value: u.id, data: {}, user: null });
export const invokers: Invokers = [];
