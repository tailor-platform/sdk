import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-node-builtin-imports";
const RESOLVER =
  'import { createResolver } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", body: () => 1 });\n';

describe("rejects Node built-in imports in a file that defines a platform function", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `import { readFile } from "node:fs/promises";\n${RESOLVER}`,
        errors: [
          '"node:fs/promises" is not available in the Tailor Platform runtime. File system access is not available in the Tailor Platform runtime.',
        ],
      },
      {
        code: `import path from "path";\n${RESOLVER}`,
        errors: [
          '"path" is not available in the Tailor Platform runtime. Use URL or URLPattern for path manipulation.',
        ],
      },
      {
        code: `import * as os from "node:os";\n${RESOLVER}`,
        errors: ['"node:os" is not available in the Tailor Platform runtime.'],
      },
      {
        code: `import "node:process";\n${RESOLVER}`,
        errors: ['"node:process" is not available in the Tailor Platform runtime.'],
      },
    ],
  });
});

describe("rejects re-exports and static dynamic imports of Node built-ins", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: `export { createHash } from "node:crypto";\n${RESOLVER}`,
        errors: [
          '"node:crypto" is not available in the Tailor Platform runtime. Use the Web Crypto API (globalThis.crypto) instead.',
        ],
      },
      {
        code: `export * from "node:events";\n${RESOLVER}`,
        errors: [
          '"node:events" is not available in the Tailor Platform runtime. Use EventTarget instead.',
        ],
      },
      {
        code: `${RESOLVER}export const load = () => import("node:zlib");`,
        errors: [
          '"node:zlib" is not available in the Tailor Platform runtime. Use CompressionStream and DecompressionStream Web APIs instead.',
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
      code: `import fs from "fs";\n${definition}`,
      errors: [
        '"fs" is not available in the Tailor Platform runtime. File system access is not available in the Tailor Platform runtime.',
      ],
    })),
  });
});

describe("drops the suggestion in files that only define HTTP adapters", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: 'import http from "node:http";\nimport { createHttpAdapter } from "@tailor-platform/sdk";\nexport default createHttpAdapter({ name: "a", pathPattern: "/x", input: {}, output: () => 1 });',
        errors: ['"node:http" is not available in the Tailor Platform runtime.'],
      },
    ],
  });
});

describe("ignores files that define no platform function", () => {
  runRuleTests(RULE, {
    valid: [
      'import { readFileSync } from "node:fs";\nexport const text = readFileSync("x", "utf8");',
      'import { randomUUID } from "node:crypto";\nimport { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: randomUUID() });',
    ],
  });
});

describe("ignores type-only imports, non-builtin modules, and require calls", () => {
  runRuleTests(RULE, {
    valid: [
      `import type { Stats } from "node:fs";\n${RESOLVER}`,
      `import { type Stats } from "node:fs";\n${RESOLVER}`,
      `export type { Stats } from "node:fs";\n${RESOLVER}`,
      `export { type Stats } from "node:fs";\n${RESOLVER}`,
      `import { format } from "date-fns";\nimport { getDB } from "../generated/tailordb";\n${RESOLVER}`,
      `${RESOLVER}export const load = () => import(\`./locale/\${name}\`);`,
      `${RESOLVER}const fs = require("fs");`,
    ],
  });
});

describe("ignores same-named factories from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import fs from "node:fs";\nimport { createResolver } from "another-sdk";\nexport default createResolver({ body: () => fs });',
    ],
  });
});
