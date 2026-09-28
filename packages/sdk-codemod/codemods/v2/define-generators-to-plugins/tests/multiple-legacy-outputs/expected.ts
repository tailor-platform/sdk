import { definePlugins } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export const dbGenerators = definePlugins(kyselyTypePlugin({ distPath: "db.ts" }));
export const enumGenerators = definePlugins(enumConstantsPlugin({ distPath: "enums.ts" }));
