export * from "./schema";
export type * from "./types";

import { IdProviderSchema } from "./schema";
import type { IdProviderConfig, IdProviderConfigInput } from "./types";

export function parseIdProviderConfig(
  config: IdProviderConfigInput,
): IdProviderConfig {
  return IdProviderSchema.parse(config) as IdProviderConfig;
}
