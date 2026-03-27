import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export const generators = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "manager-machine-user" }),
);
