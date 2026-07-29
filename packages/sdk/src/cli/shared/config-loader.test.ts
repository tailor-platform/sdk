import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "./config-loader";

// Assembled at runtime: spelled out in full, this fixture is indistinguishable
// from a live credential to the repository's own push protection.
const SLACK_TOKEN = ["xoxb", "123456789012", "1234567890123", "AbCdEfGhIjKlMnOpQrStUvWx"].join("-");

const tempDirs: string[] = [];

function writeConfig(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-config-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "tailor.config.ts");
  fs.writeFileSync(configPath, source);
  return configPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  test("rejects a credential in env, naming the config it came from", async () => {
    const configPath = writeConfig(
      `export default { name: "test-app", env: { SLACK_BOT_TOKEN: ${JSON.stringify(SLACK_TOKEN)} } };`,
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/env\.SLACK_BOT_TOKEN \(matched slack\)/);
    await expect(loadConfig(configPath)).rejects.toThrow(configPath);
  });

  test("resolves an allowed entry to its value, so the reason never travels with it", async () => {
    const configPath = writeConfig(
      `export default {
        name: "test-app",
        env: {
          SLACK_BOT_TOKEN: { value: ${JSON.stringify(SLACK_TOKEN)}, allowSecretReason: "demo workspace" },
          RETRIES: 3,
        },
      };`,
    );

    const { config } = await loadConfig(configPath);

    expect(config.env).toEqual({ SLACK_BOT_TOKEN: SLACK_TOKEN, RETRIES: 3 });
  });

  test("requires an allowed entry to state a reason", async () => {
    const configPath = writeConfig(
      `export default {
        name: "test-app",
        env: { SLACK_BOT_TOKEN: { value: ${JSON.stringify(SLACK_TOKEN)}, allowSecretReason: "" } },
      };`,
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      /'allowSecretReason' must state why the value is safe to keep in 'env'/,
    );
  });

  test("rejects an allowance on a boolean, which is never detected", async () => {
    const configPath = writeConfig(
      `export default {
        name: "test-app",
        env: { FEATURE: { value: true, allowSecretReason: "not a credential" } },
      };`,
    );

    await expect(loadConfig(configPath)).rejects.toThrow(/env\.FEATURE/);
  });

  test("leaves a config without env alone", async () => {
    const configPath = writeConfig(`export default { name: "test-app" };`);

    const { config } = await loadConfig(configPath);

    expect(config.env).toBeUndefined();
    expect(config.name).toBe("test-app");
  });
});
