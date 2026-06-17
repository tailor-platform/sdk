import { db, t, type TailorUser } from "@tailor-platform/sdk";
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";

const roleCreate = ({ value, user }: { value: string; user: TailorUser | null }) =>
  user?.attributes.role === "ADMIN" ? value : "user";

function hasMachineUser({ user }: { user: TailorUser | null }) {
  return user?.type === "machine_user";
}

const hasInvoker = (ctx: { user: TailorUser | null }) => ctx.user?.id !== "";

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
