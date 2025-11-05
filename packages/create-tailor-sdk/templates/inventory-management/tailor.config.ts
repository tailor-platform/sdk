import {
  defineAuth,
  defineConfig,
  defineGenerators,
} from "@tailor-platform/tailor-sdk";
import { user } from "./src/db/user";

export default defineConfig({
  name: "inventory-management",
  db: { "main-db": { files: [`./src/db/*.ts`] } },
  resolver: { "main-resolver": { files: [`./src/pipeline/*.ts`] } },
  auth: defineAuth("main-auth", {
    userProfile: {
      type: user,
      usernameField: "email",
      attributes: {
        role: true,
      },
    },
    machineUsers: {
      manager: {
        attributes: { role: "MANAGER" },
      },
      staff: {
        attributes: { role: "STAFF" },
      },
    },
  }),
  executor: { files: ["./src/executor/*.ts"] },
});

export const generators = defineGenerators([
  "@tailor/kysely-type",
  { distPath: `./src/generated/kysely-tailordb.ts` },
]);
