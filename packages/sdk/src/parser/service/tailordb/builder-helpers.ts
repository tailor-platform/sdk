import { isSdkBranded } from "#/utils/brand";
import { TailorDBTypeSchema } from "./schema";

const TAILORDB_TYPE_SCHEMA_KEYS = TailorDBTypeSchema.keyof().options;

export function stripTailorDBTypeBuilderHelpers(type: unknown): unknown {
  if (!isSdkBranded(type, "tailordb-type")) {
    return type;
  }

  return pickTailorDBTypeSchemaKeys(type);
}

/**
 * Keep only the TailorDBTypeSchema keys of an object, regardless of SDK
 * branding. Structural copies of builder tables (e.g. spread clones from
 * plugins) lose the non-enumerable brand but still carry builder helper
 * methods that a strict schema parse would reject.
 * @param type - Candidate table value
 * @returns An object with only schema keys, or the value itself when it is not an object
 */
export function pickTailorDBTypeSchemaKeys(type: unknown): unknown {
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
