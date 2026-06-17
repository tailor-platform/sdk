import { db, t, type TailorPrincipal } from "@tailor-platform/sdk";

const roleCreate = ({ value, invoker }: { value: string; invoker: TailorPrincipal | null }) =>
  invoker?.attributes.role === "ADMIN" ? value : "user";

function hasMachineUser({ invoker }: { invoker: TailorPrincipal | null }) {
  return invoker?.type === "machine_user";
}

const hasInvoker = (ctx: { invoker: TailorPrincipal | null }) => ctx.invoker?.id !== "";

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
  .validate(hasInvoker);

const reviewer = t.string();
const zodLike = { parse: (arg: unknown) => arg };

export const user = db
  .type("User", {
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
