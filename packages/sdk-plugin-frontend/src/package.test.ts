import { definePlugins, defineStaticWebSite } from "@tailor-platform/sdk";
import { FrontendPluginID, frontendPlugin } from "@tailor-platform/sdk-plugin-frontend";
import { expect, test } from "vitest";

test("registers the independent package with the SDK's public configuration API", () => {
  const website = defineStaticWebSite("web", { description: "Web app" });
  const plugins = definePlugins(frontendPlugin({ site: website, distDir: "dist" }));

  expect(FrontendPluginID).toBe("@tailor-platform/frontend");
  expect(plugins).toMatchObject([
    {
      id: "@tailor-platform/frontend",
      pluginConfig: [{ site: website, distDir: "dist" }],
      onDeployed: expect.any(Function),
    },
  ]);
});
