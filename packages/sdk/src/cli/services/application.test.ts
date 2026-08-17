import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { defineConfig } from "#/configure/config/index";
import { defineAIGateway } from "#/configure/services/aigateway/index";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { defineStaticWebSite } from "#/configure/services/staticwebsite/index";
import { db } from "#/configure/services/tailordb/schema";
import { getRegisteredWaitPoints, restoreWaitPointRegistry } from "#/utils/wait-point-registry";
import { defineApplication, loadApplication } from "./application";

describe("defineAuth parse wiring", () => {
  test("preserves an explicit userProfile.namespace through AuthConfigSchema.parse", async () => {
    const userType = db.table("User", {
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

describe("AI Gateway authNamespace default", () => {
  test("defaults an omitted authNamespace to the local auth service's name", () => {
    const auth = defineAuth("my-auth", { machineUserAttributes: {}, machineUsers: {} });
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({ name: "testApp", auth, aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.aiGatewayServices[0]?.authNamespace).toBe("my-auth");
  });

  test("defaults an omitted authNamespace to an external auth service's name", () => {
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({
        name: "testApp",
        auth: { name: "shared-auth", external: true },
        aiGateways: [aiGateway],
      }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.aiGatewayServices[0]?.authNamespace).toBe("shared-auth");
  });

  test("keeps an explicit authNamespace even when it differs from the local auth service", () => {
    const auth = defineAuth("my-auth", { machineUserAttributes: {}, machineUsers: {} });
    const aiGateway = defineAIGateway("my-aigateway", { authNamespace: "other-apps-auth" });

    const config = {
      ...defineConfig({ name: "testApp", auth, aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    const application = defineApplication({ config });

    expect(application.aiGatewayServices[0]?.authNamespace).toBe("other-apps-auth");
  });

  test("throws when authNamespace is omitted and no Auth service is configured", () => {
    const aiGateway = defineAIGateway("my-aigateway", {});

    const config = {
      ...defineConfig({ name: "testApp", aiGateways: [aiGateway] }),
      path: "tailor.config.ts",
    };

    expect(() => defineApplication({ config })).toThrow(
      /AI Gateway "my-aigateway" has no "authNamespace"/,
    );
  });
});

describe("loadApplication wait point key check", () => {
  let tmpDir: string | undefined;
  // The registry is process-wide, so the key this fixture declares would
  // otherwise reach the check another test file runs.
  const mark = getRegisteredWaitPoints().length;

  afterEach(() => {
    restoreWaitPointRegistry(mark);
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("rejects a key declared only by an executor, with no workflow files to load", async () => {
    // Place the fixture inside the SDK package so its dynamic import can
    // resolve `@tailor-platform/sdk` through the workspace node_modules tree.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".application-")));
    const executorFile = path.join(tmpDir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, createWaitPoint, incomingWebhookTrigger } from "@tailor-platform/sdk";

export const review = createWaitPoint("needsReview");

export default createExecutor({
  name: "webhook-executor",
  trigger: incomingWebhookTrigger({ response: () => ({}) }),
  operation: { kind: "function", body: () => {} },
});
`,
    );

    const config = {
      ...defineConfig({
        name: "testApp",
        executor: { files: [executorFile] },
      }),
      path: path.join(tmpDir, "tailor.config.ts"),
    };

    await expect(loadApplication({ config })).rejects.toThrow(
      /Invalid wait point key "needsReview"/,
    );
  });
});
