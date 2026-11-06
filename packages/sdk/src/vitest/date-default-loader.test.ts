import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aroundAll, describe, expect, test } from "vitest";
import { runWithTsHook } from "#/cli/shared/test-helpers/ts-hook-child";
import { definePlugins } from "#/configure/config/index";
import { kyselyTypePlugin } from "#/plugin/builtin/kysely-type/index";
import { dateDefaultFromConfig, kyselyTemporalFromConfig } from "./date-default-loader";

describe("dateDefaultFromConfig", () => {
  test("reads defaultDateRepresentation from the default export", () => {
    expect(dateDefaultFromConfig({ default: { defaultDateRepresentation: "temporal" } })).toBe(
      "temporal",
    );
  });

  test("an absent setting keeps the legacy representation", () => {
    expect(dateDefaultFromConfig({ default: {} })).toBe("legacy");
    expect(dateDefaultFromConfig({ default: { defaultDateRepresentation: undefined } })).toBe(
      "legacy",
    );
    expect(dateDefaultFromConfig({})).toBe("legacy");
  });

  test("reads a date default from the default export", () => {
    expect(dateDefaultFromConfig({ default: { defaultDateRepresentation: "date" } })).toBe("date");
  });

  test("a value the config schema rejects fails instead of silently keeping strings", () => {
    expect(() =>
      dateDefaultFromConfig({ default: { defaultDateRepresentation: "string" } }),
    ).toThrow(/defaultDateRepresentation.*"string"/);
    expect(() => dateDefaultFromConfig({ default: { defaultDateRepresentation: true } })).toThrow(
      /defaultDateRepresentation/,
    );
  });
});

describe("kyselyTemporalFromConfig", () => {
  test("reads temporal from the config of the kysely type plugin the config exports", () => {
    expect(
      kyselyTemporalFromConfig({
        plugins: definePlugins(kyselyTypePlugin({ distPath: "./db.ts", temporal: true })),
      }),
    ).toBe(true);
  });

  test("is false when the plugin leaves temporal off or the config does not use the plugin", () => {
    expect(
      kyselyTemporalFromConfig({
        plugins: definePlugins(kyselyTypePlugin({ distPath: "./db.ts" })),
      }),
    ).toBe(false);
    expect(kyselyTemporalFromConfig({ plugins: [{ id: "other", pluginConfig: {} }] })).toBe(false);
    expect(kyselyTemporalFromConfig({ default: {} })).toBe(false);
    expect(kyselyTemporalFromConfig(undefined)).toBe(false);
  });
});

// The loader runs in the Vitest host, where `import()` is Node's own. Inside a
// worker vite-node intercepts it, so these cases run the loader in a child
// Node process to exercise the TypeScript hook and Node's real errors.
describe("loadConfigDefaultsFromConfig: date default", { timeout: 60_000 }, () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const loaderPath = resolve(here, "date-default-loader.ts");
  let tmpDir: string;

  aroundAll(async (runSuite) => {
    tmpDir = mkdtempSync(join(tmpdir(), "tailor-runtime-date-default-loader-"));
    await runSuite();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  type Outcome = { value?: string; error?: string; warnings: string[] };

  const run = (configPath: string): Outcome =>
    runWithTsHook(
      `
      const { loadConfigDefaultsFromConfig } = await import(${JSON.stringify(pathToFileURL(loaderPath).href)});
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(" "));
      try {
        const { dateDefault: value } = await loadConfigDefaultsFromConfig(${JSON.stringify(configPath)});
        console.log(JSON.stringify({ value, warnings }));
      } catch (error) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error), warnings }));
      }
      `,
      here,
    ) as Outcome;

  const fixture = (name: string, files: Record<string, string>): string => {
    const dir = join(tmpDir, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(dir, file), content, "utf8");
    }
    return join(dir, "tailor.config.ts");
  };

  test("resolves the config's extensionless imports the way the CLI does", () => {
    const configPath = fixture("extensionless", {
      "sibling.ts": `export const setting: "temporal" = "temporal";\n`,
      "tailor.config.ts": `import { setting } from "./sibling";\nexport default { name: "app", defaultDateRepresentation: setting };\n`,
    });
    expect(run(configPath)).toEqual({ value: "temporal", warnings: [] });
  });

  test("a config whose module constructs a tailordb client at module scope loads like in the CLI", () => {
    const configPath = fixture("module-scope-client", {
      "db.ts": `export const client = new tailordb.Client({ namespace: "main" });\n`,
      "tailor.config.ts": `import { client } from "./db";\nexport default { name: "app", defaultDateRepresentation: "temporal", client };\n`,
    });
    expect(run(configPath)).toEqual({ value: "temporal", warnings: [] });
  });

  test("a config without the setting reads as the legacy representation", () => {
    const configPath = fixture("unset", {
      "tailor.config.ts": `export default { name: "app" };\n`,
    });
    expect(run(configPath)).toEqual({ value: "legacy", warnings: [] });
  });

  test("a missing config file fails the run", () => {
    const outcome = run(join(tmpDir, "nowhere", "tailor.config.ts"));
    expect(outcome.error).toMatch(/not found at .*nowhere.*tailor\.config\.ts.*config/s);
  });

  test("a config that does not parse fails the run", () => {
    const configPath = fixture("syntax", {
      "tailor.config.ts": `export default { name: "app", defaultDateRepresentation: "temporal"\n`,
    });
    expect(run(configPath).error).toMatch(/could not parse .*tailor\.config\.ts/);
  });

  test("a config that sets an invalid value fails the run", () => {
    const configPath = fixture("invalid", {
      "tailor.config.ts": `export default { name: "app", defaultDateRepresentation: "string" };\n`,
    });
    expect(run(configPath).error).toMatch(/must be "temporal", "date", or omitted/);
  });

  test("a SyntaxError thrown while the config runs is an evaluation failure, not a parse failure", () => {
    const configPath = fixture("runtime-syntax-error", {
      "tailor.config.ts": `const parsed = JSON.parse(process.env.TAILOR_TEST_UNSET_VARIABLE ?? "{not json");\nexport default { name: "app", ...parsed };\n`,
    });
    const outcome = run(configPath);
    expect(outcome.value).toBe("legacy");
    expect(outcome.warnings).toHaveLength(1);
  });

  test("a config that throws while loading warns and keeps the legacy representation", () => {
    const configPath = fixture("throws", {
      "tailor.config.ts": `if (!process.env.TAILOR_TEST_UNSET_VARIABLE) throw new Error("missing env");\nexport default { name: "app", defaultDateRepresentation: "temporal" };\n`,
    });
    const outcome = run(configPath);
    expect(outcome.value).toBe("legacy");
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatch(/string values.*tailor\.d\.ts.*missing env/s);
  });
});

describe("loadConfigDefaultsFromConfig: kysely temporal", { timeout: 60_000 }, () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const loaderPath = resolve(here, "date-default-loader.ts");
  let tmpDir: string;

  aroundAll(async (runSuite) => {
    tmpDir = mkdtempSync(join(tmpdir(), "tailor-runtime-kysely-temporal-loader-"));
    await runSuite();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const run = (config: string): boolean => {
    const dir = mkdtempSync(join(tmpDir, "case-"));
    const configPath = join(dir, "tailor.config.ts");
    writeFileSync(configPath, config, "utf8");
    return (
      runWithTsHook(
        `
        const { loadConfigDefaultsFromConfig } = await import(${JSON.stringify(pathToFileURL(loaderPath).href)});
        console.log(JSON.stringify({ value: (await loadConfigDefaultsFromConfig(${JSON.stringify(configPath)})).kyselyTemporal }));
        `,
        here,
      ) as { value: boolean }
    ).value;
  };

  test("reads temporal from the kysely type plugin the config exports", () => {
    expect(
      run(
        `export default { name: "app" };\nexport const plugins = [{ id: "@tailor-platform/kysely-type", pluginConfig: { distPath: "./db.ts", temporal: true } }];\n`,
      ),
    ).toBe(true);
  });

  test("is false for a config that does not use the plugin", () => {
    expect(run(`export default { name: "app" };\n`)).toBe(false);
  });

  test("is false for a config that throws while loading", () => {
    expect(run(`throw new Error("boom");\n`)).toBe(false);
  });
});
