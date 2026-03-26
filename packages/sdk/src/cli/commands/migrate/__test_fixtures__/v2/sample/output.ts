// Sample fixture: expected output file after migration
// This demonstrates the fixture-based test pattern.
// Real fixtures will be added alongside actual migration rules.

import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
