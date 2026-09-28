import { defineGenerators } from "@tailor-platform/sdk";

export const generators = (defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "db.ts" },
]) satisfies unknown[]) as unknown[];
