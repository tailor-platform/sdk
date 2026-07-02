import { TailorDBTypeSchema } from "./schema";

const TAILORDB_TYPE_SCHEMA_KEYS = TailorDBTypeSchema.keyof().options;

export function stripTailorDBTypeBuilderHelpers(type: unknown): unknown {
  if (typeof type !== "object" || type === null) {
    return type;
  }

  const config: Record<string, unknown> = {};
  const input = type as Record<string, unknown>;
  for (const key of TAILORDB_TYPE_SCHEMA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      config[key] = input[key];
    }
  }
  return config;
}
