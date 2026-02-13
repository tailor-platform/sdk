import { defineConfig, defineStaticWebSite } from "@tailor-platform/sdk";

const website = defineStaticWebSite("my-storefront", {
  description: "Storefront application",
});

export default defineConfig({
  name: "challenge-031",
  cors: [website.url],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  staticWebsites: [website],
});
