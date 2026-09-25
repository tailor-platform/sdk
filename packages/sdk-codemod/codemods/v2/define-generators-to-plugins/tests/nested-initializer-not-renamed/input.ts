import { defineGenerators } from "@tailor-platform/sdk";

export const config = {
  generators: defineGenerators(["@tailor-platform/kysely-type", { distPath: "db.ts" }]),
};
