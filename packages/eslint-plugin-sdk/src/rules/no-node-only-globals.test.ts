/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, expect, test } from "vitest";
import { expectClean, expectViolation, lintOutput } from "./test-helpers.js";

const RULE = "no-node-only-globals";
const RESOLVER =
  'import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1 });\n';

describe("no-node-only-globals", () => {
  test("rejects Node-only globals in a file that defines a platform function", () => {
    expectViolation(
      `${RESOLVER}export const region = process.env.REGION;`,
      RULE,
      '"process" is not available in the Tailor Platform runtime. Use `defineConfig({ env })`',
    );
    expectViolation(
      `${RESOLVER}export const encode = (s: string) => Buffer.from(s).toString("base64");`,
      RULE,
      '"Buffer" is not available in the Tailor Platform runtime. Use Uint8Array or ArrayBuffer instead.',
    );
    expectViolation(
      `${RESOLVER}export const dir = __dirname;`,
      RULE,
      '"__dirname" is not available in the Tailor Platform runtime.',
    );
    expectViolation(
      `${RESOLVER}setImmediate(() => 1);`,
      RULE,
      '"setImmediate" is not available in the Tailor Platform runtime. Use setTimeout instead.',
    );
  });

  test.each([
    [
      'import { createExecutor } from "@tailor-platform/sdk";\nexport default createExecutor({ name: "e", trigger, body: () => 1 });',
    ],
    [
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const job = createWorkflowJob({ name: "j", body: () => 1 });',
    ],
  ])("recognizes files that define executors and workflow jobs", (definition) => {
    expectViolation(
      `${definition}\nexport const region = process.env.REGION;`,
      RULE,
      '"process" is not available in the Tailor Platform runtime.',
    );
  });

  test("drops the suggestion in files that only define HTTP adapters", () => {
    const source =
      'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ name: "a", pathPattern: "/x", input: {}, output: () => 1 });\nexport const region = process.env.REGION;';
    expectViolation(source, RULE, '"process" is not available in the Tailor Platform runtime.');
    expect(lintOutput(source, RULE)).not.toContain("defineConfig");
  });

  test("ignores files that define no platform function", () => {
    expectClean(
      'import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: process.env.NAME ?? "app" });',
      RULE,
    );
    expectClean("export const dir = __dirname;", RULE);
  });

  test("ignores locally bound, property, type-position, and typeof-guarded uses", () => {
    expectClean(`${RESOLVER}export const run = (process: string) => process.length;`, RULE);
    expectClean(
      `${RESOLVER}import { process } from "./pipeline";\nexport const run = () => process();`,
      RULE,
    );
    expectClean(`${RESOLVER}export const value = config.process.module;`, RULE);
    expectClean(`${RESOLVER}export const value = { process: 1, Buffer: 2 };`, RULE);
    expectClean(`${RESOLVER}export type Env = typeof process.env;`, RULE);
    expectClean(`${RESOLVER}export const isNode = typeof process !== "undefined";`, RULE);
    expectClean(
      `${RESOLVER}export const region = typeof process !== "undefined" && process.env.REGION;`,
      RULE,
    );
    expectClean(
      `${RESOLVER}export const region = typeof process === "undefined" ? undefined : process.env.REGION;`,
      RULE,
    );
  });

  test("still reports references outside a typeof guard", () => {
    expectViolation(
      `${RESOLVER}export const region = typeof process === "undefined" && process.env.REGION;`,
      RULE,
      '"process" is not available',
    );
    expectViolation(
      `${RESOLVER}const isNode = typeof process !== "undefined";\nexport const region = process.env.REGION;`,
      RULE,
      '"process" is not available',
    );
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import { createResolver } from "another-sdk";\nexport default createResolver({ body: () => process.env.X });',
      RULE,
    );
  });
});
