import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-node-only-globals";
const RESOLVER =
  'import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1 });\n';
const PROCESS =
  '"process" is not available in the Tailor Platform runtime. Use `defineConfig({ env })` and the `env` argument passed into the body function instead.';
const BUFFER =
  '"Buffer" is not available in the Tailor Platform runtime. Use Uint8Array or ArrayBuffer instead.';

describe("rejects Node-only globals in a file that defines a platform function", () => {
  runRuleTests(RULE, {
    invalid: [
      { code: `${RESOLVER}export const region = process.env.REGION;`, errors: [PROCESS] },
      {
        code: `${RESOLVER}export const encode = (s: string) => Buffer.from(s).toString("base64");`,
        errors: [BUFFER],
      },
      {
        code: `${RESOLVER}export const dir = __dirname;`,
        errors: [
          '"__dirname" is not available in the Tailor Platform runtime. File system paths are not available in the Tailor Platform runtime.',
        ],
      },
      {
        code: `${RESOLVER}setImmediate(() => 1);`,
        errors: [
          '"setImmediate" is not available in the Tailor Platform runtime. Use setTimeout instead.',
        ],
      },
    ],
  });
});

describe("recognizes files that define executors and workflow jobs", () => {
  runRuleTests(RULE, {
    invalid: [
      'import { createExecutor } from "@tailor-platform/sdk";\nexport default createExecutor({ name: "e", trigger, body: () => 1 });',
      'import { createWorkflowJob } from "@tailor-platform/sdk";\nexport const job = createWorkflowJob({ name: "j", body: () => 1 });',
    ].map((definition) => ({
      code: `${definition}\nexport const region = process.env.REGION;`,
      errors: [PROCESS],
    })),
  });
});

describe("drops the suggestion in files that only define HTTP adapters", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ name: "a", pathPattern: "/x", input: {}, output: () => 1 });\nexport const region = process.env.REGION;',
        errors: ['"process" is not available in the Tailor Platform runtime.'],
      },
    ],
  });
});

describe("ignores the `global` keyword of a global augmentation", () => {
  runRuleTests(RULE, {
    valid: [`${RESOLVER}declare global {\n  var appVersion: string;\n}`],
    invalid: [
      {
        code: `${RESOLVER}declare global {\n  var appVersion: string;\n}\nexport const g = global;`,
        errors: [
          '"global" is not available in the Tailor Platform runtime. Use globalThis instead.',
        ],
      },
    ],
  });
});

describe("ignores files that define no platform function", () => {
  runRuleTests(RULE, {
    valid: [
      'import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: process.env.NAME ?? "app" });',
      "export const dir = __dirname;",
    ],
  });
});

describe("ignores locally bound, property, type-position, and typeof-guarded uses", () => {
  runRuleTests(RULE, {
    valid: [
      `${RESOLVER}export const run = (process: string) => process.length;`,
      `${RESOLVER}import { process } from "./pipeline";\nexport const run = () => process();`,
      `${RESOLVER}export const value = config.process.module;`,
      `${RESOLVER}export const region = globalThis.process.env.REGION;`,
      `${RESOLVER}export const value = { process: 1, Buffer: 2 };`,
      `${RESOLVER}export type Env = typeof process.env;`,
      `${RESOLVER}export const isNode = typeof process !== "undefined";`,
      `${RESOLVER}export const region = typeof process !== "undefined" && process.env.REGION;`,
      `${RESOLVER}export const region = typeof process === "undefined" ? undefined : process.env.REGION;`,
      `${RESOLVER}export const region = typeof process != "undefined" && typeof process.env !== "undefined" && process.env.REGION;`,
      `${RESOLVER}export const region = typeof process === "undefined" || !process.env ? undefined : process.env.REGION;`,
    ],
  });
});

describe("ignores export aliases and re-exports from other modules", () => {
  runRuleTests(RULE, {
    valid: [
      `${RESOLVER}const proc = 1;\nexport { proc as process };`,
      `${RESOLVER}export { process } from "./pipeline";`,
      `${RESOLVER}export { Buffer as bytes } from "./bytes";`,
      `${RESOLVER}const proc = 1;\nexport { proc as "process" };`,
      `${RESOLVER}export * as process from "./pipeline";`,
    ],
  });
});

describe("still reports references shadowed only by an ambient declaration", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${RESOLVER}declare const process: { env: Record<string, string> };\nexport const region = process.env.REGION;`,
        errors: [PROCESS],
      },
      {
        code: `${RESOLVER}declare const process: { env: Record<string, string> };\nexport { process };`,
        errors: [PROCESS],
      },
      {
        code: `${RESOLVER}declare function require(id: string): unknown;\nexport const fs = require("fs");`,
        errors: [
          '"require" is not available in the Tailor Platform runtime. Use a static `import` instead.',
        ],
      },
    ],
  });
});

describe("still reports references shadowed only by a type declaration", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${RESOLVER}type Buffer = Uint8Array;\nexport const encode = (): Buffer => Buffer.from("x");`,
        errors: [BUFFER],
      },
      {
        code: `${RESOLVER}interface process { env: Record<string, string> }\nexport const region = process.env.REGION;`,
        errors: [PROCESS],
      },
    ],
  });
});

describe("still reports references outside a typeof guard", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `${RESOLVER}export const region = typeof process === "undefined" && process.env.REGION;`,
        errors: [PROCESS],
      },
      {
        code: `${RESOLVER}const isNode = typeof process !== "undefined";\nexport const region = process.env.REGION;`,
        errors: [PROCESS],
      },
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createResolver } from "another-sdk";\nexport default createResolver({ body: () => process.env.X });',
    ],
  });
});
