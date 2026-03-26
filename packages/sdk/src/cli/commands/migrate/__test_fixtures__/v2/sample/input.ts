// Sample fixture: input file before migration
// This demonstrates the fixture-based test pattern.
// Real fixtures will be added alongside actual migration rules.

import { defineGenerators } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export const generators = defineGenerators(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
);
