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
  test("reports a config path that does not exist as CONFIG_NOT_FOUND", async () => {
    const configPath = path.join(os.tmpdir(), "tailor-config-missing", "tailor.config.ts");

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      code: "CONFIG_NOT_FOUND",
      message: `Configuration file not found: ${configPath}`,
      suggestion: expect.stringContaining("--config"),
      context: { file: configPath },
    });
    expect(getErrorDiagnostics(error).location).toBeUndefined();
  });

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
      [{ path: [], message: "expected an array returned by definePlugins(), got object" }],
      undefined,
    ],
    [
      "is explicitly undefined",
      "undefined",
      [{ path: [], message: "expected an array returned by definePlugins(), got undefined" }],
      undefined,
    ],
    [
      "is null",
      "null",
      [{ path: [], message: "expected an array returned by definePlugins(), got null" }],
      undefined,
    ],
    [
      "contains an invalid item",
      `[{ id: "valid", description: "Valid item" }, null]`,
      [{ path: [1], message: "Invalid input: expected object, received null" }],
      undefined,
    ],
    [
      "repeats a plugin ID",
      `[{ id: "dup", description: "First" }, { id: "dup", description: "Second" }]`,
      [{ path: [1, "id"], message: 'Duplicate plugin ID "dup"' }],
      "Give each plugin a unique ID.",
    ],
  ])(
    "reports a `plugins` export that %s as CONFIG_INVALID, pointing at the config file",
    async (_case, pluginsExport, issues, suggestion) => {
      const configPath = writeConfig(`
        export default { name: "test-app" };
        export const plugins = ${pluginsExport};
      `);

      const error = await rejectionOf(loadConfig(configPath));

      expect(error).toMatchObject({
        code: "CONFIG_INVALID",
        context: { file: configPath, exportName: "plugins", issues },
      });
      expect(error).toHaveProperty("suggestion", suggestion);
      expect(error.message).toMatch(/^Invalid `plugins` export:\n/);
      expect(error.message).not.toContain("tailor.config");
      expect(getErrorDiagnostics(error).location).toEqual({ file: configPath });
    },
  );

  test("reports every rejected `plugins` item together", async () => {
    const configPath = writeConfig(`
      export default { name: "test-app" };
      export const plugins = [
        { id: "dup", description: "First" },
        null,
        { id: "dup", description: "Second" },
      ];
    `);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      context: {
        issues: [
          { path: [1], message: "Invalid input: expected object, received null" },
          { path: [2, "id"], message: 'Duplicate plugin ID "dup"' },
        ],
      },
    });
  });

  test("reports an invalid default export as CONFIG_INVALID", async () => {
    const configPath = writeConfig(`export default { name: "" };`);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      message: `Invalid Tailor config:\n  - name: 'name' must be a non-empty string.`,
      context: {
        file: configPath,
        exportName: "default",
        issues: [{ path: ["name"], message: "'name' must be a non-empty string." }],
      },
    });
  });

  test("keeps a field's own message for a value outside its allowed set", async () => {
    const configPath = writeConfig(`export default { name: "test-app", maintenanceMode: "yes" };`);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      context: {
        issues: [
          {
            path: ["maintenanceMode"],
            message: `'maintenanceMode' must be false, "migration", or "deploy".`,
          },
        ],
      },
    });
  });

  test("reports an invalid `plugins` item as CONFIG_INVALID, naming its index", async () => {
    const configPath = writeConfig(`
      export default { name: "test-app" };
      export const plugins = [{ id: "valid", description: "Valid item" }, null];
    `);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      message: `Invalid \`plugins\` export:\n  - 1: Invalid input: expected object, received null`,
      context: {
        file: configPath,
        exportName: "plugins",
        issues: [{ path: [1], message: "Invalid input: expected object, received null" }],
      },
    });
  });

  test("rejects a plugin that defines both TailorDB namespace hook names", async () => {
    const configPath = writeConfig(`
      export default { name: "test-app" };
      export const plugins = [{
        id: "both",
        description: "Defines both names",
        importPath: "@example/both",
        onTailorDBNamespaceLoaded: () => ({}),
        onNamespaceLoaded: () => ({}),
      }];
    `);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      context: {
        exportName: "plugins",
        issues: [
          {
            path: [0, "onNamespaceLoaded"],
            message:
              "'onNamespaceLoaded' is the deprecated name of 'onTailorDBNamespaceLoaded'. Define only 'onTailorDBNamespaceLoaded'.",
          },
        ],
      },
    });
  });

  test("reports a module without a default export as CONFIG_INVALID, pointing at the config file", async () => {
    const configPath = writeConfig(`export const name = "test-app";`);

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({
      code: "CONFIG_INVALID",
      message: "Invalid Tailor config:\n  - (root): default export not found",
      suggestion: "Export the config as the default export: export default defineConfig({ ... })",
      context: {
        file: configPath,
        exportName: "default",
        issues: [{ path: [], message: "default export not found" }],
      },
    });
    expect(getErrorDiagnostics(error).location).toEqual({ file: configPath });
  });

  test("rejects a credential in env, pointing at the config it came from", async () => {
    const configPath = writeConfig(
      `export default { name: "test-app", env: { SLACK_BOT_TOKEN: ${JSON.stringify(SLACK_TOKEN)} } };`,
    );

    const error = await rejectionOf(loadConfig(configPath));

    expect(error).toMatchObject({ code: "CONFIG_INVALID", context: { file: configPath } });
    expect(error.message).not.toContain(configPath);
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
  test("reports unparsable source as SYNTAX_INVALID at the line it failed on", () => {
    const result = atConfigSource(syntaxDiagnostic, "/repo/tailor.config.ts");

    expect(result).toMatchObject({
      name: "CLIError",
      code: "SYNTAX_INVALID",
      message: `Invalid syntax: Unexpected token \`=\`. Expected an identifier`,
      context: { file: "/repo/tailordb/User.ts", line: 4 },
      cause: syntaxDiagnostic,
    });
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

    expect(result).toMatchObject({
      message: `Invalid syntax: Unexpected token \`=\`. Expected an identifier`,
    });
    expect((result as { context?: unknown }).context).toEqual({ file: "/repo/tailordb/User.ts" });
    expect(getErrorDiagnostics(result as Error).location).toEqual({
      file: "/repo/tailordb/User.ts",
    });
  });
});
