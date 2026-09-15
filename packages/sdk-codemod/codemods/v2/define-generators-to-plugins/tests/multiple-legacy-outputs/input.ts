import { defineGenerators } from "@tailor-platform/sdk";

export const dbGenerators = defineGenerators(["@tailor-platform/kysely-type", { distPath: "db.ts" }]);
export const enumGenerators = defineGenerators([
  "@tailor-platform/enum-constants",
  { distPath: "enums.ts" },
]);
