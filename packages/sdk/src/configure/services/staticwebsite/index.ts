import type { StaticWebsiteInput } from "@/parser/service/staticwebsite/types";

declare const staticWebsiteDefinitionBrand: unique symbol;
type StaticWebsiteDefinitionBrand = {
  readonly [staticWebsiteDefinitionBrand]: true;
};

/**
 * Define a static website configuration for the Tailor SDK.
 * @param {string} name - Static website name
 * @param {Omit<StaticWebsiteInput, "name">} config - Static website configuration
 * @returns {StaticWebsiteDefinitionBrand & StaticWebsiteInput & { readonly url: string }} Defined static website
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

export type StaticWebsiteConfig = Omit<ReturnType<typeof defineStaticWebSite>, "url">;
