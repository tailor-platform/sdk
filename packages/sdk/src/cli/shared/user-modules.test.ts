import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { tempDir } from "./test-helpers/temp-dir";
import { runWithTsHook } from "./test-helpers/ts-hook-child";
import {
  beginUserModuleRun,
  currentImportNonce,
  IMPORT_NONCE_PARAM,
  importUserModule,
} from "./user-modules";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__test_fixtures__/user-module-counter.ts",
);

type CounterState = typeof globalThis & {
  __tailorUserModuleCounterCount?: number;
};

function evaluationCount(): number {
  return (globalThis as CounterState).__tailorUserModuleCounterCount ?? 0;
}

// ts-hook.mjs cannot import this module, so it declares the same parameter
// name as its own constant; this pin and the hook tests' URL literals keep
// the two in sync.
test("uses the query parameter name the ts-hook propagates", () => {
  expect(IMPORT_NONCE_PARAM).toBe("tailorImportNonce");
});

describe("importUserModule", () => {
  aroundEach(async (runTest) => {
    try {
      await runTest();
    } finally {
      delete (globalThis as CounterState).__tailorUserModuleCounterCount;
    }
  });

  test("caches within a run and re-evaluates when a new run begins", async () => {
    const initialNonce = currentImportNonce();
    await importUserModule(fixturePath);
    await importUserModule(fixturePath);
    expect(evaluationCount()).toBe(1);

    beginUserModuleRun();
    const firstRunNonce = currentImportNonce();
    expect(firstRunNonce).toBeDefined();
    expect(firstRunNonce).not.toBe(initialNonce);
    await importUserModule(fixturePath);
    await importUserModule(fixturePath);
    expect(evaluationCount()).toBe(2);

    beginUserModuleRun();
    expect(currentImportNonce()).not.toBe(firstRunNonce);
    await importUserModule(fixturePath);
    expect(evaluationCount()).toBe(3);
  });
});

describe("importUserModule rejections", { timeout: 60_000 }, () => {
  const importRejection = (file: string): unknown =>
    runWithTsHook(
      `
      const { importUserModule } = await import("#/cli/shared/user-modules");
      const { getErrorDiagnostics } = await import("#/cli/shared/error-diagnostics");
      try {
        await importUserModule(${JSON.stringify(file)});
        console.log(JSON.stringify({}));
      } catch (error) {
        const { name, message, code, context } = error;
        console.log(JSON.stringify({ name, message, code, context, location: getErrorDiagnostics(error).location }));
      }
      `,
      path.dirname(file),
    );

  test("reports source that does not parse as SYNTAX_INVALID at the file and line it failed on", () => {
    using tmp = tempDir("sdk-user-module-syntax-");
    const file = path.join(tmp.dir, "broken.ts");
    fs.writeFileSync(file, "export const ok = 1;\nexport const broken = ;\n");

    expect(importRejection(file)).toEqual({
      name: "CLIError",
      code: "SYNTAX_INVALID",
      message: "Invalid syntax in broken.ts:2: Expression expected",
      context: { file, line: 2 },
      location: { file, line: 2 },
    });
  });

  test("passes other failures through unchanged", () => {
    using tmp = tempDir("sdk-user-module-throws-");
    const file = path.join(tmp.dir, "throws.ts");
    fs.writeFileSync(file, `throw new Error("boom");\n`);

    expect(importRejection(file)).toEqual({ name: "Error", message: "boom" });
  });
});
