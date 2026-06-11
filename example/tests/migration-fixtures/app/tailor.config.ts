import { db, defineAuth, defineConfig } from "@tailor-platform/sdk";

export const auth = defineAuth("migration-auth", {
  machineUserAttributes: {
    role: db.enum(["MANAGER", "STAFF"]),
  },
  machineUsers: {
    "manager-machine-user": {
      attributes: {
        role: "MANAGER",
      },
    },
  },
});

export default defineConfig({
  id: "de2efacb-1a8a-4acc-bf61-9037db3e0238",
  name: "migration-e2e",
  auth,
  db: {
    migrationdb: {
      files: ["./tailordb/*.ts"],
      migration: {
        directory: "./migrations",
        machineUser: "manager-machine-user",
      },
    },
  },
});
