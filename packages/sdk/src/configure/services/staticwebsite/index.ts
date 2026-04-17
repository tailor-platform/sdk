import type { StaticWebsiteDefinitionBrand } from "@/types/staticwebsite-config";
import type { StaticWebsiteInput } from "@/types/staticwebsite.generated";
export type { StaticWebsiteConfig } from "@/types/staticwebsite-config";

/**
 * Define a static website configuration for the Tailor SDK.
 * @param name - Static website name
 * @param config - Static website configuration
 * @returns Defined static website
 */
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
