import { db, t } from "@tailor-platform/sdk";
import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";

const role = db
  .string()
  .hooks({
    create: ({ value, user }) => (user?.attributes.role === "ADMIN" ? value : "user"),
  })
  .validate([({ user }) => user?.type === "machine_user", "Machine user required"]);

export const user = db
  .type("User", {
    role,
    note: db.string(),
  })
  .hooks({
    note: {
      create: ({ user: currentUser }) => currentUser?.id ?? "anonymous",
    },
  });

export const parsed = t.string().parse({
  value: "hello",
  data: {},
  user: unauthenticatedTailorUser,
});
