import type { AppConfig } from "#/configure/config/types";
import type { EffectiveDateDefault } from "#/runtime/types";

type DateDefaultSource = Pick<AppConfig, "defaultDateRepresentation">;

/**
 * Resolve a config's `defaultDateRepresentation` to the representation applied
 * to `t` date fields that omit `as`.
 * @param config - The loaded app config.
 * @returns The configured representation, otherwise `"legacy"` (string values).
 */
export function effectiveDateDefault(config: DateDefaultSource): EffectiveDateDefault {
  return config.defaultDateRepresentation ?? "legacy";
}
