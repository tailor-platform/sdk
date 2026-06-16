import type { StaticWebsiteDefinitionBrand } from "@/configure/services/staticwebsite/types";
import type { StaticWebsiteInput } from "@/types/staticwebsite.generated";
export type { StaticWebsiteConfig } from "@/configure/services/staticwebsite/types";

/**
 * Define a static website configuration for the Tailor SDK.
 * @param name - Static website name
 * @param config - Static website configuration
 * @returns Defined static website
 */
/* @__NO_SIDE_EFFECTS__ */
export function defineStaticWebSite(name: string, config: Omit<StaticWebsiteInput, "name">) {
  const result = {
    ...config,
    name,
    get url() {
      return `${name}:url` as const;
    },
  } as const satisfies StaticWebsiteInput & { readonly url: string };

  return result as typeof result & StaticWebsiteDefinitionBrand;
}
