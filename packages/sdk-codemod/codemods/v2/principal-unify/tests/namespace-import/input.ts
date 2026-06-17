import * as sdk from "@tailor-platform/sdk";

type User = sdk.TailorUser;

const role = sdk.db.string().hooks({
  create: ({ user }: { user: sdk.TailorUser | null }) => user?.id ?? "anonymous",
});

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
