import type { SomeType } from "@tailor-platform/sdk/cli";
import type { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export type Plugin = typeof kyselyTypePlugin;
export type Other = SomeType;
