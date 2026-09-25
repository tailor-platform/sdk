import { defineConfig } from "@tailor-platform/sdk/cli";
import { type kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export type Plugin = typeof kyselyTypePlugin;
export default defineConfig({});
