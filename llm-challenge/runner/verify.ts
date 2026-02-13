import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ProblemMeta } from "../shared/helpers";

export type StageInput = {
  stage: "generate" | "typecheck" | "tests";
  passed: boolean;
  output: string;
  testsPassed?: number;
  testsTotal?: number;
};

function runCommand(command: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { success: true, output };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message: string };
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
    };
  }
}

type VitestJsonResult = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
};

function parseVitestJson(output: string): { passed: number; total: number } | undefined {
  // vitest --reporter=json outputs JSON to stdout, possibly mixed with other output
  // Try to find the JSON object in the output
  const jsonMatch = output.match(/\{[\s\S]*"numTotalTests"\s*:/);
  if (!jsonMatch) {
    return undefined;
  }

  // Find the start of the JSON object
  const startIdx = output.indexOf(jsonMatch[0]);
  if (startIdx === -1) {
    return undefined;
  }

  // Try to parse from the start of the JSON object
  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < output.length; i++) {
    if (output[i] === "{") {
      depth++;
    } else if (output[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  try {
    const parsed = JSON.parse(output.slice(startIdx, endIdx)) as VitestJsonResult;
    return {
      passed: parsed.numPassedTests,
      total: parsed.numTotalTests,
    };
  } catch {
    return undefined;
  }
}

/**
 * Run the three verification stages on a work directory.
 * Returns early (skipping later stages) if an earlier stage fails.
 */
export function verifyProblem(
  workDir: string,
  _meta: ProblemMeta,
  challengeRoot: string,
): StageInput[] {
  const results: StageInput[] = [];

  // Stage 1: generate
  const sdkBin = path.join(challengeRoot, "..", "packages", "sdk", "dist", "cli", "index.mjs");
  if (!fs.existsSync(sdkBin)) {
    const msg = `SDK binary not found at ${sdkBin}. Run 'pnpm -C packages/sdk build' first.`;
    results.push({ stage: "generate", passed: false, output: msg });
    results.push({ stage: "typecheck", passed: false, output: "Skipped (generate failed)" });
    results.push({ stage: "tests", passed: false, output: "Skipped (generate failed)" });
    return results;
  }
  const generateResult = runCommand(`node ${sdkBin} generate -c tailor.config.ts`, workDir);
  results.push({
    stage: "generate",
    passed: generateResult.success,
    output: generateResult.output,
  });
  if (!generateResult.success) {
    results.push({ stage: "typecheck", passed: false, output: "Skipped (generate failed)" });
    results.push({ stage: "tests", passed: false, output: "Skipped (generate failed)" });
    return results;
  }

  // Stage 2: typecheck
  const typecheckResult = runCommand("npx tsc --noEmit", workDir);
  results.push({
    stage: "typecheck",
    passed: typecheckResult.success,
    output: typecheckResult.output,
  });
  if (!typecheckResult.success) {
    results.push({ stage: "tests", passed: false, output: "Skipped (typecheck failed)" });
    return results;
  }

  // Stage 3: tests (use JSON reporter for partial scoring)
  const problemDir = path.dirname(workDir);
  const testsDir = path.join(problemDir, "tests");
  const testResult = runCommand(
    `npx vitest run --reporter=json --config ${path.join(challengeRoot, "vitest.config.ts")} --root ${challengeRoot} ${testsDir}`,
    workDir,
  );

  const testStage: StageInput = {
    stage: "tests",
    passed: testResult.success,
    output: testResult.output,
  };

  // Parse JSON output to extract individual test results
  const parsed = parseVitestJson(testResult.output);
  if (parsed) {
    testStage.testsPassed = parsed.passed;
    testStage.testsTotal = parsed.total;
  }

  results.push(testStage);

  return results;
}
