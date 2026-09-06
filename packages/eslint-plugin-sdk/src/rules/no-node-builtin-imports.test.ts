/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { describe, expect, test } from "vitest";
import { expectClean, expectViolation, lintOutput } from "./test-helpers.js";

const RULE = "no-node-builtin-imports";
const RESOLVER =
  'import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1 });\n';

describe("no-node-builtin-imports", () => {
  test("rejects Node built-in imports in a file that defines a platform function", () => {
    expectViolation(
      `import { readFile } from "node:fs/promises";\n${RESOLVER}`,
      RULE,
      '"node:fs/promises" is not available in the Tailor Platform runtime. File system access is not available',
    );
    expectViolation(
      `import path from "path";\n${RESOLVER}`,
      RULE,
      '"path" is not available in the Tailor Platform runtime. Use URL or URLPattern for path manipulation.',
    );
    expectViolation(
      `import * as os from "node:os";\n${RESOLVER}`,
      RULE,
      '"node:os" is not available in the Tailor Platform runtime.',
    );
    expectViolation(`import "node:process";\n${RESOLVER}`, RULE, '"node:process" is not available');
  });

  test("rejects re-exports and static dynamic imports of Node built-ins", () => {
    expectViolation(
      `export { createHash } from "node:crypto";\n${RESOLVER}`,
      RULE,
      '"node:crypto" is not available',
    );
    expectViolation(
      `export * from "node:events";\n${RESOLVER}`,
      RULE,
      '"node:events" is not available',
    );
    expectViolation(
      `${RESOLVER}export const load = () => import("node:zlib");`,
      RULE,
      '"node:zlib" is not available in the Tailor Platform runtime. Use CompressionStream',
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
    expectViolation(`import fs from "fs";\n${definition}`, RULE, '"fs" is not available');
  });

  test("drops the suggestion in files that only define HTTP adapters", () => {
    const source =
      'import http from "node:http";\nimport { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ name: "a", pathPattern: "/x", input: {}, output: () => 1 });';
    expectViolation(source, RULE, '"node:http" is not available in the Tailor Platform runtime.');
    expect(lintOutput(source, RULE)).not.toContain("Fetch API");
  });

  test("ignores files that define no platform function", () => {
    expectClean(
      'import { readFileSync } from "node:fs";\nexport const text = readFileSync("x", "utf8");',
      RULE,
    );
    expectClean(
      'import { randomUUID } from "node:crypto";\nimport { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: randomUUID() });',
      RULE,
    );
  });

  test("ignores type-only imports, non-builtin modules, and require calls", () => {
    expectClean(`import type { Stats } from "node:fs";\n${RESOLVER}`, RULE);
    expectClean(`import { type Stats } from "node:fs";\n${RESOLVER}`, RULE);
    expectClean(`export type { Stats } from "node:fs";\n${RESOLVER}`, RULE);
    expectClean(
      `import { format } from "date-fns";\nimport { getDB } from "../generated/tailordb";\n${RESOLVER}`,
      RULE,
    );
    expectClean(`${RESOLVER}export const load = () => import(\`./locale/\${name}\`);`, RULE);
    expectClean(`${RESOLVER}const fs = require("fs");`, RULE);
  });

  test("ignores same-named factories from other packages", () => {
    expectClean(
      'import fs from "node:fs";\nimport { createResolver } from "another-sdk";\nexport default createResolver({ body: () => fs });',
      RULE,
    );
  });
});
