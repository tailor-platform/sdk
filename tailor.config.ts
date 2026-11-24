import { db, defineAuth, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

const auth = defineAuth("ws-auth", {
  machineUserAttributes: { role: db.string() },
  machineUsers: { admin: { attributes: { role: "ADMIN" } } },
});

// defineWorkspace() is not exported yet: this is the mark it gives its return value.
export default Object.defineProperty(
  {
    db: {
      "main-db": { files: ["./db/main/*.ts"], migration: { directory: "./migrations/main-db" } },
      "order-db": { files: ["./db/order/*.ts"], migration: { directory: "./migrations/order-db" } },
      "ledger-db": { files: ["./db/ledger/*.ts"], migration: { directory: "./migrations/ledger-db" } },
    },
    auth: { "ws-auth": auth },
    apps: {
      shop: { db: ["main-db", "order-db"], auth: "ws-auth" },
      backoffice: { db: ["main-db"], auth: "ws-auth" },
    },
  },
  Symbol.for("tailor-platform/sdk"),
  { value: "workspace-config" },
);

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "admin" }),
);
