import * as v from "valibot";

// strip unknown keys
export const StaticWebsiteSchema = v.pipe(
  v.strictObject({
    name: v.pipe(v.string(), v.description("Static website name")),
    description: v.optional(v.pipe(v.string(), v.description("Static website description"))),
    allowedIpAddresses: v.optional(
      v.pipe(v.array(v.string()), v.description("IP addresses allowed to access the website")),
    ),
    customDomains: v.optional(
      v.pipe(v.array(v.string()), v.description("Custom domains for the static website")),
    ),
  }),
  v.brand("StaticWebsiteConfig"),
);
