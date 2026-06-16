import { db, t } from "@tailor-platform/sdk";
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";

const role = db
  .string()
  .hooks({
    create: ({ value, user }) => (user?.attributes.role === "ADMIN" ? value : "user"),
    update: ctx => ctx.user?.id ?? "anonymous",
  })
  .validate([
    [({ user }) => user?.type === "machine_user", "Machine user required"],
    ctx => ctx.user?.id !== "",
  ]);

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
    },
  })
  .validate({
    note: (ctx) => ctx.user?.type !== "machine_user",
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
