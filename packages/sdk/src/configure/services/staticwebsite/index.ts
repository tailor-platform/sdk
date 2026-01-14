import type { StaticWebsiteInput } from "@/parser/service/staticwebsite/types";

declare const staticWebsiteDefinitionBrand: unique symbol;
type StaticWebsiteDefinitionBrand = {
  readonly [staticWebsiteDefinitionBrand]: true;
};

/**
 * Define a static website configuration for the Tailor SDK.
 * @template Name
 * @param {Name} name - Static website name
 * @param {Omit<StaticWebsiteInput, "name">} config - Static website configuration
 * @returns {StaticWebsiteDefinitionBrand & StaticWebsiteInput & { readonly name: Name; readonly url: string }} Defined static website
 */
export function defineStaticWebSite<const Name extends string>(
  name: Name,
  config: Omit<StaticWebsiteInput, "name">,
) {
  const result = {
    ...config,
    name,
    get url() {
      return `${name}:url` as const;
    },
  } as const;

  return result as typeof result & StaticWebsiteDefinitionBrand;
}

export type StaticWebsiteConfig<Name extends string = string> = Omit<StaticWebsiteInput, "name"> & {
  name: Name;
};
