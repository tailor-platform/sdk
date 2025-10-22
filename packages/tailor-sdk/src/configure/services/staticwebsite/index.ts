import type { StaticWebsiteInput } from "@/parser/service/staticwebsite/types";

export type { StaticWebsiteInput as StaticWebsiteServiceInput } from "@/parser/service/staticwebsite/types";

export function defineStaticWebSite(
  name: string,
  config: Omit<StaticWebsiteInput, "name">,
) {
  return {
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
}

export type StaticWebsiteConfig = ReturnType<typeof defineStaticWebSite>;
