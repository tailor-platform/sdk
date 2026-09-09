/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAbsolute } from "node:path";
import { describe, expect, test } from "vitest";
import { tailorRuntime } from "./index";

describe("tailorRuntime", () => {
  const ENV_VAR = "__TAILOR_RUNTIME_CONFIG";

  const configEnvOf = (test: any): string | undefined => test?.env?.[ENV_VAR];

  test("returns the block plugin and the environment plugin in order", () => {
    const plugins = tailorRuntime();
    expect(plugins).toHaveLength(2);
    expect(plugins[0]?.name).toBe("tailor-runtime-block-node");
    expect(plugins[1]?.name).toBe("tailor-runtime-environment");
  });

  test("forwards options.config to the environment plugin (seeds the test env)", () => {
    const plugins = tailorRuntime({ config: "./tailor.config.ts" });
    const envPlugin = plugins[1]!;
    const userConfig: any = { test: { environment: "tailor-runtime" } };
    (envPlugin.config as any).call({}, userConfig);

    expect(isAbsolute(configEnvOf(userConfig.test) ?? "")).toBe(true);
    expect(configEnvOf(userConfig.test)).toMatch(/tailor\.config\.ts$/);
  });

  test("does not set the env var when options is omitted", () => {
    const plugins = tailorRuntime();
    const envPlugin = plugins[1]!;
    const userConfig: any = { test: { environment: "tailor-runtime" } };
    (envPlugin.config as any).call({}, userConfig);

    expect(configEnvOf(userConfig.test)).toBeUndefined();
  });

  test("environment plugin merges its setup file (so it composes with tailorRuntime() entry)", () => {
    const plugins = tailorRuntime();
    const envPlugin = plugins[1]!;
    const merged = (envPlugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(merged.test.setupFiles).toHaveLength(1);
    expect(merged.test.setupFiles[0]).toMatch(/setup\.mjs$/);
  });
});
