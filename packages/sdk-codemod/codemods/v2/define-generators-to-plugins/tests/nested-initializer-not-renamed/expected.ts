import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export const config = {
  generators: definePlugins(kyselyTypePlugin({ distPath: "db.ts" })),
};
