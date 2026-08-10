import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import {
  getRegisteredWaitPoints,
  getScopedWaitPoints,
  restoreWaitPointRegistry,
} from "#/utils/wait-point-registry";
import { deploy } from "./deploy";

const configPath = "src/cli/commands/deploy/__test_fixtures__/reload/tailor.config.ts";
const outputDir = path.join(path.dirname(configPath), "dist");

type ReloadCounters = typeof globalThis & {
  __tailorReloadConfigCount?: number;
  __tailorReloadWorkflowCount?: number;
};

function counters(): { config: number; workflow: number } {
  const state = globalThis as ReloadCounters;
  return {
    config: state.__tailorReloadConfigCount ?? 0,
    workflow: state.__tailorReloadWorkflowCount ?? 0,
  };
}

describe("repeated in-process deploy", () => {
  aroundEach(async (runTest) => {
    const registryMark = getRegisteredWaitPoints().length;
    const previousOutputDir = process.env.TAILOR_BUILD_OUTPUT_DIR;
    process.env.TAILOR_BUILD_OUTPUT_DIR = outputDir;
    try {
      await runTest();
    } finally {
      restoreWaitPointRegistry(registryMark);
      if (previousOutputDir === undefined) {
        delete process.env.TAILOR_BUILD_OUTPUT_DIR;
      } else {
        process.env.TAILOR_BUILD_OUTPUT_DIR = previousOutputDir;
      }
      const state = globalThis as ReloadCounters;
      delete state.__tailorReloadConfigCount;
      delete state.__tailorReloadWorkflowCount;
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test("re-evaluates user modules and re-registers wait points on each run", async () => {
    await deploy({ configPath, buildOnly: true, noCache: true });
    expect(counters()).toEqual({ config: 1, workflow: 1 });
    const firstRunWaitPoints = getScopedWaitPoints();
    expect(firstRunWaitPoints.length).toBeGreaterThan(0);

    await deploy({ configPath, buildOnly: true, noCache: true });
    expect(counters()).toEqual({ config: 2, workflow: 2 });
    expect(getScopedWaitPoints()).toEqual(firstRunWaitPoints);
  }, 60000);
});
