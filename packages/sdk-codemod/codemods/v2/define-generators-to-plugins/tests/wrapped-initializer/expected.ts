import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export const plugins = (definePlugins(kyselyTypePlugin({ distPath: "db.ts" })) satisfies unknown[]) as unknown[];
