import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { beginUserModuleRun, currentImportNonce, importUserModule } from "./user-modules";

const fixturePath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "__test_fixtures__/user-module-counter.ts",
);

type CounterState = typeof globalThis & {
  __tailorUserModuleCounterCount?: number;
};

function evaluationCount(): number {
  return (globalThis as CounterState).__tailorUserModuleCounterCount ?? 0;
}

describe("importUserModule", () => {
  aroundEach(async (runTest) => {
    try {
      await runTest();
    } finally {
      delete (globalThis as CounterState).__tailorUserModuleCounterCount;
    }
  });

  test("caches within a run and re-evaluates when a new run begins", async () => {
    expect(currentImportNonce()).toBeUndefined();
    await importUserModule(fixturePath);
    await importUserModule(fixturePath);
    expect(evaluationCount()).toBe(1);

    beginUserModuleRun();
    const firstRunNonce = currentImportNonce();
    expect(firstRunNonce).toBeDefined();
    await importUserModule(fixturePath);
    await importUserModule(fixturePath);
    expect(evaluationCount()).toBe(2);

    beginUserModuleRun();
    expect(currentImportNonce()).not.toBe(firstRunNonce);
    await importUserModule(fixturePath);
    expect(evaluationCount()).toBe(3);
  });
});
