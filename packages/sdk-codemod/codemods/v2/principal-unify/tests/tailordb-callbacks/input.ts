import { db, t, type TailorUser } from "@tailor-platform/sdk";
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";

const roleCreate = ({ value, user }: { value: string; user: TailorUser | null }) =>
  user?.attributes.role === "ADMIN" ? value : "user";

function hasMachineUser({ user }: { user: TailorUser | null }) {
  return user?.type === "machine_user";
}

const hasInvoker = (ctx: { user: TailorUser | null }) => ctx.user?.id !== "";

type HookArgs = {
  value: string;
  user: TailorUser | null;
};

interface ValidatorArgs {
  user: TailorUser | null;
}

const namedTypeHook = ({ user }: HookArgs) => user?.id ?? "anonymous";
const namedTypeValidator = ({ user }: ValidatorArgs) => user?.id !== "";

type StrictHookArgs = {
  value: string;
  user: TailorUser;
};

const strictHook = ({ user }: { user: TailorUser }) => {
  const { id } = user;
  return id;
};

const namedStrictHook = ({ user }: StrictHookArgs) => {
  const { id } = user;
  return id;
};

const sharedHooks = {
  create: ({ user }: { user: TailorUser | null }) => user?.id ?? "anonymous",
  update: namedTypeHook,
};

const role = db
  .string()
  .hooks({
    create: roleCreate,
    update: (ctx: { user: TailorUser | null }) => ctx.user?.id ?? "anonymous",
    delete({ user }) {
      return user?.id ?? "anonymous";
    },
  })
  .validate([
    [hasMachineUser, "Machine user required"],
    ctx => ctx.user?.id !== "",
  ])
  .validate(hasInvoker)
  .validate(namedTypeValidator);

const localHookedRole = db.string().hooks(sharedHooks);
const strictHookedRole = db.string().hooks({ create: strictHook, update: namedStrictHook });

const directHookedRole = db.string().hooks({
  create: ({ user }) => {
    const { id } = user;
    return id;
  },
  update: (ctx) => ctx.user.id,
});

const reviewer = t.string();
const zodLike = { parse: (arg: unknown) => arg };

export const user = db
  .type("User", {
    role,
    note: db.string(),
  })
  .hooks({
    note: {
      create: ({ user: currentUser }) => {
        const audit = [{ user: { id: "data-user" } }].map(({ user }) => user.id);
        return currentUser?.id ?? audit[0] ?? "anonymous";
      },
      update({ user }) {
        const invoker = user?.id ?? "anonymous";
        return invoker;
      },
    },
  })
  .validate({
    note: (ctx) => ctx.user?.type !== "machine_user",
    fallback: ({ user = unauthenticatedTailorUser }) => {
      const labels = ["anonymous"].map((invoker) => invoker);
      return user?.id !== labels[0];
    },
    typed: ({ user }: { user: TailorUser | null }) => user?.id !== "",
  });

export const audit = db
  .type("Audit", {
    create: db.string(),
    update: db.string(),
  })
  .hooks({
    create: {
      create: ({ user }: { user: TailorUser | null }) => user?.id ?? "anonymous",
      update: (ctx: { user: TailorUser | null }) => ctx.user?.id ?? "anonymous",
    },
  });

export const parsed = t.string().parse({
  value: "hello",
  data: {},
  user: unauthenticatedTailorUser,
});

export const parsedLocal = reviewer.parse({
  value: "hello",
  data: {},
  user: unauthenticatedTailorUser,
});

export const parsedOther = zodLike.parse({
  user: unauthenticatedTailorUser,
});

export function parseWithShadow(reviewer: { parse(arg: unknown): unknown }, user: unknown) {
  return reviewer.parse({ user });
}
