import { describe, expect, test } from "vitest";
import { defineConfig } from "@/configure/config";
import { defineAuth } from "@/configure/services/auth";
import { defineIdp } from "@/configure/services/idp";
import { defineStaticWebSite } from "@/configure/services/staticwebsite";
import { db } from "@/configure/services/tailordb/schema";
import { defineApplication } from "./application";

describe("defineAuth parse wiring", () => {
  test("preserves an explicit userProfile.namespace through AuthConfigSchema.parse", async () => {
    const userType = db.type("User", {
      email: db.string().unique(),
      role: db.string(),
    });

    const config = {
      ...defineConfig({
        name: "testApp",
        // A single TailorDB namespace ("main"). Without the fix the explicit
        // namespace is stripped by parse and auto-resolution falls back to "main".
        db: { main: { files: [] } },
        auth: defineAuth("my-auth", {
          userProfile: {
            namespace: "external-ns",
            type: userType,
            usernameField: "email",
            attributes: { role: true },
          },
          machineUsers: {
            admin: { attributes: { role: "ADMIN" } },
          },
        }),
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });
    expect(application.authService).toBeDefined();

    await application.authService!.resolveNamespaces();

    expect(application.authService!.userProfile?.namespace).toBe("external-ns");
  });

  test("accepts defineIdp helper objects when parsing IdP services", () => {
    const idp = defineIdp("my-idp", {
      clients: ["default-client"],
    });

    const config = {
      ...defineConfig({
        name: "testApp",
        idp: [idp],
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.idpServices).toHaveLength(1);
    expect(application.idpServices[0]?.name).toBe("my-idp");
  });

  test("accepts defineStaticWebSite helper objects when parsing static websites", () => {
    const website = defineStaticWebSite("my-site", {
      description: "my website",
    });

    const config = {
      ...defineConfig({
        name: "testApp",
        staticWebsites: [website],
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.staticWebsiteServices).toHaveLength(1);
    expect(application.staticWebsiteServices[0]?.name).toBe("my-site");
  });
});
