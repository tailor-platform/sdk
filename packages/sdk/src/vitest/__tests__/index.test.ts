/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAbsolute } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { tailorRuntime } from "../index";

describe("tailorRuntime", () => {
  const ENV_VAR = "__TAILOR_RUNTIME_CONFIG";
  let originalConfig: string | undefined;

  beforeEach(() => {
    originalConfig = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalConfig === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = originalConfig;
  });

  test("returns the block plugin and the environment plugin in order", () => {
    const plugins = tailorRuntime();
    expect(plugins).toHaveLength(2);
    expect(plugins[0]?.name).toBe("tailor-runtime-block-node");
    expect(plugins[1]?.name).toBe("tailor-runtime-environment");
  });

  test("forwards options.config to the environment plugin (sets process env var)", () => {
    const plugins = tailorRuntime({ config: "./tailor.config.ts" });
    const envPlugin = plugins[1]!;
    (envPlugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBeDefined();
    expect(isAbsolute(process.env[ENV_VAR] ?? "")).toBe(true);
    expect(process.env[ENV_VAR]).toMatch(/tailor\.config\.ts$/);
  });

  test("does not set the env var when options is omitted", () => {
    const plugins = tailorRuntime();
    const envPlugin = plugins[1]!;
    (envPlugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(process.env[ENV_VAR]).toBeUndefined();
  });

  test("environment plugin merges its setup file (so it composes with tailorRuntime() entry)", () => {
    const plugins = tailorRuntime();
    const envPlugin = plugins[1]!;
    const merged = (envPlugin.config as any).call({}, { test: { environment: "tailor-runtime" } });

    expect(merged.test.setupFiles).toHaveLength(1);
    expect(merged.test.setupFiles[0]).toMatch(/setup\.mjs$/);
  });
});
