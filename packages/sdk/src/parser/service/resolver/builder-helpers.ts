import { isSdkBranded } from "#/utils/brand";

const RESOLVER_BUILDER_HELPER_KEYS = ["trigger"] as const;

export function stripResolverBuilderHelpers(resolver: unknown): unknown {
  if (!isSdkBranded(resolver, "resolver") || resolver === null || typeof resolver !== "object") {
    return resolver;
  }

  const config = { ...(resolver as Record<string, unknown>) };
  for (const key of RESOLVER_BUILDER_HELPER_KEYS) {
    delete config[key];
  }
  return config;
}
