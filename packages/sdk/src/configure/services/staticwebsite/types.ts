import type { StaticWebsiteInput } from "#src/types/staticwebsite.generated";

declare const staticWebsiteDefinitionBrand: unique symbol;
export type StaticWebsiteDefinitionBrand = {
  readonly [staticWebsiteDefinitionBrand]: true;
};

/** Type accepted by `AppConfig.staticWebsites`. Only values returned by `defineStaticWebSite()` satisfy this. */
export type StaticWebsiteConfig = StaticWebsiteInput & StaticWebsiteDefinitionBrand;
