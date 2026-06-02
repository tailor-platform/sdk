import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { bundleAuthHooks } from "./bundler";

describe("bundleAuthHooks", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeConfig(): string {
    // Use realpathSync to avoid macOS symlink mismatch (/var -> /private/var)
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "auth-bundler-test-")));
    const configFile = path.join(tmpDir, "tailor.config.ts");
    fs.writeFileSync(
      configFile,
      `
const handler = async ({ claims, idpConfigName, env }) => {
  return { claims, idpConfigName, environment: env.ENVIRONMENT };
};

export default {
  auth: { hooks: { beforeLogin: { handler } } },
};
`,
    );
    return configFile;
  }

  it("injects the config env into the before-login hook args", async () => {
    const configFile = writeConfig();

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      handlerAccessPath: "auth.hooks.beforeLogin.handler",
      env: { ENVIRONMENT: "staging", RETRIES: 3 },
    });

    const code = bundled.get("auth-hook--my-auth--before-login");
    expect(code).toBeDefined();
    // The serialized env values are inlined into the generated wrapper
    expect(code).toContain("staging");
    expect(code).toContain("ENVIRONMENT");
  });

  it("injects an empty env object when none is provided", async () => {
    const configFile = writeConfig();

    const bundled = await bundleAuthHooks({
      configPath: configFile,
      authName: "my-auth",
      handlerAccessPath: "auth.hooks.beforeLogin.handler",
    });

    const code = bundled.get("auth-hook--my-auth--before-login");
    expect(code).toBeDefined();
    // The wrapper always defines an env binding, even when empty
    expect(code).toContain("env");
  });
});
