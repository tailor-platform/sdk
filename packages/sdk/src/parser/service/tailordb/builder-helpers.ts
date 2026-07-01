import { isSdkBranded } from "#/utils/brand";

const TAILORDB_TYPE_BUILDER_HELPER_KEYS = [
  "_output",
  "_description",
  "hooks",
  "validate",
  "features",
  "indexes",
  "files",
  "permission",
  "gqlPermission",
  "description",
  "pickFields",
  "omitFields",
  "plugins",
  "plugin",
] as const;

export function stripTailorDBTypeBuilderHelpers(type: unknown): unknown {
  if (!isSdkBranded(type, "tailordb-type")) {
    return type;
  }

  const config = { ...(type as Record<string, unknown>) };
  for (const key of TAILORDB_TYPE_BUILDER_HELPER_KEYS) {
    delete config[key];
  }
  return config;
}
