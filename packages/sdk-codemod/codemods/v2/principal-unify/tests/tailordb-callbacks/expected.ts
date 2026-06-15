import { db, t } from "@tailor-platform/sdk";

const role = db
  .string()
  .hooks({
    create: ({ value, invoker }) => (invoker?.attributes.role === "ADMIN" ? value : "user"),
  })
  .validate([({ invoker }) => invoker?.type === "machine_user", "Machine user required"]);

export const user = db
  .type("User", {
    role,
    note: db.string(),
  })
  .hooks({
    note: {
      create: ({ invoker: currentUser }) => currentUser?.id ?? "anonymous",
    },
  });

export const parsed = t.string().parse({
  value: "hello",
  data: {},
  invoker: null,
});
