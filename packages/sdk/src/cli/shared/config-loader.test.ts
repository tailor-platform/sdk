import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { atConfigSource, loadConfig } from "./config-loader";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";

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

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the config to be rejected");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  test("preserves class plugin state when invoking generation hooks", async () => {
    const configPath = writeConfig(`
      export default { name: "test-app" };
      class StatefulPlugin {
        id = "stateful";
        description = "Plugin with private state";
        #content = "preserved";
        onTailorDBReady() {
          return { files: [{ path: "output.txt", content: this.#content }] };
        }
      }
      export const plugins = [new StatefulPlugin()];
    `);

    const { plugins } = await loadConfig(configPath);

    expect(
      await plugins[0]!.onTailorDBReady!({
        tailordb: [],
        baseDir: path.dirname(configPath),
        configPath,
        pluginConfig: undefined,
      }),
    ).toEqual({ files: [{ path: "output.txt", content: "preserved" }] });
  });

  test("collects plugins from the `plugins` export", async () => {
    const configPath = writeConfig(`
      export default { name: "test-app", db: { marker: "preserved" } };
      export const plugins = [{ id: "first", description: "First plugin", custom: "kept" }];
    `);

    const { config, plugins } = await loadConfig(configPath);

    expect(config.db).toEqual({ marker: "preserved" });
    expect(plugins).toEqual([{ id: "first", description: "First plugin", custom: "kept" }]);
  });

  test("ignores array exports under any name other than `plugins`", async () => {
    const configPath = writeConfig(`
      export default { name: "test-app" };
      export const generators = [{ id: "legacy", description: "Legacy export name" }];
      export const plugins2 = [{ id: "second", description: "Second plugin" }];
    `);

    const { plugins } = await loadConfig(configPath);

    expect(plugins).toEqual([]);
  });

  test.each([
    [
      "is not an array",
      `{ id: "not-an-array", description: "Invalid" }`,
      /Invalid `plugins` export/,
    ],
    ["is explicitly undefined", "undefined", /Invalid `plugins` export/],
    [
      "contains an invalid item",
      `[{ id: "valid", description: "Valid item" }, null]`,
      /Invalid `plugins` export/,
    ],
    [
      "repeats a plugin ID",
      `[{ id: "dup", description: "First" }, { id: "dup", description: "Second" }]`,
      /Duplicate plugin ID "dup"/,
    ],
  ])(
    "rejects a `plugins` export that %s, pointing at the config file",
    async (_case, pluginsExport, message) => {
      const configPath = writeConfig(`
        export default { name: "test-app" };
        export const plugins = ${pluginsExport};
      `);

      const error = await rejectionOf(loadConfig(configPath));

      expect(error.message).toMatch(message);
      expect(getErrorDiagnostics(error).location).toEqual({ file: configPath });
    },
  );

  test("rejects a module without a default export, pointing at the config file", async () => {
    const configPath = writeConfig(`export const name = "test-app";`);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error.message).toContain("Invalid Tailor config module: default export not found");
    expect(getErrorDiagnostics(error).location).toEqual({ file: configPath });
  });

  test("rejects a credential in env, naming the config it came from", async () => {
    const configPath = writeConfig(
      `export default { name: "test-app", env: { SLACK_BOT_TOKEN: ${JSON.stringify(SLACK_TOKEN)} } };`,
    );

    const error = await rejectionOf(loadConfig(configPath));

    expect(error.message).toMatch(/env\.SLACK_BOT_TOKEN \(matched slack: SLACK_TOKEN\)/);
    expect(error.message).toContain(configPath);
    expect(getErrorDiagnostics(error).location).toEqual({ file: configPath });
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

// The CLI strips types with amaro, which reports source it cannot parse as a
// plain object rather than an Error. Vitest transforms these files with Vite
// instead, so the diagnostic is reproduced from its observed shape.
const syntaxDiagnostic = {
  code: "InvalidSyntax",
  message: "Unexpected token `=`. Expected an identifier",
  snippet: "const broken: = ;",
  filename: "/repo/tailordb/User.ts",
  startLine: 4,
  startColumn: 14,
  endLine: 4,
  endColumn: 15,
};

describe("atConfigSource", () => {
  test("renders unparsable source as an Error pointing at the line it failed on", () => {
    const result = atConfigSource(syntaxDiagnostic, "/repo/tailor.config.ts");

    expect(result).toBeInstanceOf(SyntaxError);
    expect((result as Error).message).toBe(syntaxDiagnostic.message);
    expect((result as Error).cause).toBe(syntaxDiagnostic);
    expect(getErrorDiagnostics(result as Error).location).toEqual({
      file: "/repo/tailordb/User.ts",
      line: 4,
    });
  });

  test("names the file unparsable source was found in, not the config importing it", () => {
    const result = atConfigSource(syntaxDiagnostic, "/repo/tailor.config.ts");

    expect(getErrorDiagnostics(result as Error).location?.file).toBe("/repo/tailordb/User.ts");
  });

  test("attributes a failure that names no source to the config file", () => {
    const result = atConfigSource(new Error("boom"), "/repo/tailor.config.ts");

    expect(getErrorDiagnostics(result as Error).location).toEqual({
      file: "/repo/tailor.config.ts",
    });
  });

  test("keeps a location the failure already carries", () => {
    const located = withErrorDiagnostics(new Error("boom"), {
      location: { file: "/repo/resolvers/order.ts", line: 9 },
    });

    const result = atConfigSource(located, "/repo/tailor.config.ts");

    expect(getErrorDiagnostics(result as Error).location).toEqual({
      file: "/repo/resolvers/order.ts",
      line: 9,
    });
  });

  test("leaves a thrown value that is not an Error alone", () => {
    const thrown = { unrecognized: true };

    expect(atConfigSource(thrown, "/repo/tailor.config.ts")).toBe(thrown);
  });

  test("omits the line when the diagnostic carries none", () => {
    const { startLine: _startLine, ...withoutLine } = syntaxDiagnostic;

    const result = atConfigSource(withoutLine, "/repo/tailor.config.ts");

    expect(getErrorDiagnostics(result as Error).location).toEqual({
      file: "/repo/tailordb/User.ts",
    });
  });
});
