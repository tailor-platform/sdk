/**
 * Resolve whether inline sourcemaps should be enabled.
 *
 * Resolution order:
 * 1. Config value (`inlineSourcemap` in defineConfig) — if explicitly set
 * 2. Environment variable `TAILOR_ENABLE_INLINE_SOURCEMAP` — if explicitly set
 * 3. Default: `true`
 * @param configValue - The `inlineSourcemap` value from AppConfig
 * @returns Whether inline sourcemaps should be enabled
 */
export function resolveInlineSourcemap(configValue?: boolean): boolean {
  if (configValue !== undefined) return configValue;
  if (process.env.TAILOR_ENABLE_INLINE_SOURCEMAP !== undefined) {
    return process.env.TAILOR_ENABLE_INLINE_SOURCEMAP === "true";
  }
  return true;
}
