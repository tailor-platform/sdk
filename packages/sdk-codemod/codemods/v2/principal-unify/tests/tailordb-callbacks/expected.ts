import { db, t, type TailorPrincipal, type TailorPrincipal as MyUser } from "@tailor-platform/sdk";

const roleCreate = ({ value, invoker }: { value: string; invoker: TailorPrincipal | null }) =>
  invoker?.attributes.role === "ADMIN" ? value : "user";

function hasMachineUser({ invoker }: { invoker: TailorPrincipal | null }) {
  return invoker?.type === "machine_user";
}

const hasInvoker = (ctx: { invoker: TailorPrincipal | null }) => ctx.invoker?.id !== "";

type HookArgs = {
  value: string;
  invoker: TailorPrincipal | null;
};

interface ValidatorArgs {
  invoker: TailorPrincipal | null;
}

const namedTypeHook = ({ invoker }: HookArgs) => invoker?.id ?? "anonymous";
const namedTypeValidator = ({ invoker }: ValidatorArgs) => invoker?.id !== "";

type StrictHookArgs = {
  value: string;
  invoker: TailorPrincipal | null;
};

const strictHook = ({ invoker }: { invoker: TailorPrincipal | null }) => {
  const { id } = invoker ?? {};
  return id;
};

const namedStrictHook = ({ invoker }: StrictHookArgs) => {
  const { id } = invoker ?? {};
  return id;
};

const aliasedStrictHook = ({ invoker }: { invoker: MyUser | null }) => invoker?.id;

const sharedHooks = {
  create: ({ invoker }: { invoker: TailorPrincipal | null }) => invoker?.id ?? "anonymous",
  update: namedTypeHook,
};

const role = db
  .string()
  .hooks({
    create: roleCreate,
    update: (ctx: { invoker: TailorPrincipal | null }) => ctx.invoker?.id ?? "anonymous",
    delete({ user }) {
      return user?.id ?? "anonymous";
    },
  })
  .validate([
    [hasMachineUser, "Machine user required"],
    ctx => ctx.invoker?.id !== "",
  ])
  .validate(hasInvoker)
  .validate(namedTypeValidator);

const localHookedRole = db.string().hooks(sharedHooks);
const strictHookedRole = db
  .string()
  .hooks({ create: strictHook, update: namedStrictHook })
  .hooks({ create: aliasedStrictHook });

const invoker = { id: "outer-invoker" };

const directHookedRole = db.string().hooks({
  create: ({ invoker }) => {
    const parsed = t.string().parse({ value: "hello", data: {}, invoker });
    const parsedOther = { parse: (arg: unknown) => arg }.parse({ user: invoker });
    const { id } = invoker ?? {};
    return parsed.value ?? invoker?.["id"] ?? id;
  },
  update: (ctx) => {
    const { invoker: user } = ctx;
    const { invoker: currentUser } = ctx;
    return user?.id ?? currentUser?.id;
  },
});

const externalInvokerHookedRole = db.string().hooks({
  create: ({ invoker: user }) => {
    const parsed = t.string().parse({ value: "hello", data: {}, invoker: user });
    return user?.id ?? invoker.id ?? parsed.value;
  },
});

const reviewer = t.string();
const zodLike = { parse: (arg: unknown) => arg };

export const user = db
  .table("User", {
    role,
    note: db.string(),
  })
  .hooks({
    note: {
      create: ({ invoker: currentUser }) => {
        const audit = [{ user: { id: "data-user" } }].map(({ user }) => user.id);
        return currentUser?.id ?? audit[0] ?? "anonymous";
      },
      update({ invoker: user }) {
        const invoker = user?.id ?? "anonymous";
        return invoker;
      },
    },
  })
  .validate({
    note: (ctx) => ctx.invoker?.type !== "machine_user",
    fallback: ({ invoker: user = null }) => {
      const labels = ["anonymous"].map((invoker) => invoker);
      return user?.id !== labels[0];
    },
    typed: ({ invoker }: { invoker: TailorPrincipal | null }) => invoker?.id !== "",
  });

export const audit = db
  .table("Audit", {
    create: db.string(),
    update: db.string(),
  })
  .hooks({
    create: {
      create: ({ invoker }: { invoker: TailorPrincipal | null }) => invoker?.id ?? "anonymous",
      update: (ctx: { invoker: TailorPrincipal | null }) => ctx.invoker?.id ?? "anonymous",
    },
  });

export const parsed = t.string().parse({
  value: "hello",
  data: {},
  invoker: null,
});

export const parsedLocal = reviewer.parse({
  value: "hello",
  data: {},
  invoker: null,
});

export const parsedOther = zodLike.parse({
  user: null,
});

export function parseWithShadow(reviewer: { parse(arg: unknown): unknown }, user: unknown) {
  return reviewer.parse({ user });
}
