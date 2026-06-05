import { describe, it, expect } from "vitest";
import { defineConfig } from "@/configure/config";
import { defineAuth } from "@/configure/services/auth";
import { db } from "@/configure/services/tailordb/schema";
import { defineApplication } from "./application";

describe("defineAuth parse wiring", () => {
  it("preserves an explicit userProfile.namespace through AuthConfigSchema.parse", async () => {
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
});
