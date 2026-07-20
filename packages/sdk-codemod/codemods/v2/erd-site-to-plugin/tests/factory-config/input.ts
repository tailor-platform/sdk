import { defineConfig } from "@tailor-platform/sdk";

export function makeConfig(erdSiteName: string) {
  return defineConfig({
    name: "my-app",
    db: {
      tailordb: { files: ["./tailordb/*.ts"], erdSite: erdSiteName },
    },
  });
}
