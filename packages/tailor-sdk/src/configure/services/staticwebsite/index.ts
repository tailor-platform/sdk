import type { StaticWebsiteInput } from "@/parser/service/staticwebsite/types";

declare const staticWebsiteDefinitionBrand: unique symbol;
type StaticWebsiteDefinitionBrand = {
  readonly [staticWebsiteDefinitionBrand]: true;
};

export function defineStaticWebSite(
  name: string,
  config: Omit<StaticWebsiteInput, "name">,
) {
  const result = {
    ...config,
    name,
    get url() {
      return `${name}:url` as const;
    },
    get callbackUrl() {
      return `${name}:url/callback` as const;
    },
  } as const satisfies StaticWebsiteInput & {
    readonly url: string;
    readonly callbackUrl: string;
  };

  return result as typeof result & StaticWebsiteDefinitionBrand;
}

export type StaticWebsiteConfig = Omit<
  ReturnType<typeof defineStaticWebSite>,
  "url" | "callbackUrl"
>;
