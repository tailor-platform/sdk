import type { ExecException } from "node:child_process";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ProblemMeta } from "../shared/helpers";
import { runApiCheck } from "./api-check";

const execAsync = promisify(exec);

// Partial scoring for generate stage (out of GENERATE_PARTIAL_TOTAL)
const GENERATE_PARTIAL_FILE_EXISTS = 1; // 20% — all expected files exist
const GENERATE_PARTIAL_IMPORT_CHECK = 3; // 60% — files compile with tsc
const GENERATE_PARTIAL_TOTAL = 5;

function filterNpmWarnings(output: string): string {
  return output
    .split("\n")
    .filter((line) => !line.startsWith("npm warn "))
    .join("\n")
    .trim();
}

export type TestDetail = {
  name: string;
  status: "passed" | "failed";
  failureMessage?: string;
};

export type StageInput = {
  stage: "generate" | "apiCheck" | "typecheck" | "tests";
  passed: boolean;
  output: string;
  durationMs?: number;
  testsPassed?: number;
  testsTotal?: number;
  testDetails?: TestDetail[];
};

async function runCommand(
  command: string,
  cwd: string,
): Promise<{ success: boolean; output: string; durationMs: number }> {
  const start = performance.now();
  try {
    const { stdout } = await execAsync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, output: stdout, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const error = err as ExecException & { stdout?: string; stderr?: string };
    const stdout = error.stdout ?? "";
    const stderr = filterNpmWarnings(error.stderr ?? "");
    const output = [stdout, stderr].filter(Boolean).join("\n") || error.message;
    return {
      success: false,
      output,
      durationMs,
    };
  }
}

type VitestAssertionResult = {
  fullName: string;
  status: string;
  failureMessages: string[];
};

type VitestTestResult = {
  assertionResults: VitestAssertionResult[];
};

type VitestJsonResult = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: VitestTestResult[];
};

type ParsedVitestResult = {
  passed: number;
  total: number;
  testDetails: TestDetail[];
};

function parseVitestJson(output: string): ParsedVitestResult | undefined {
  // vitest --reporter=json outputs JSON to stdout, possibly mixed with other output
  // Try to find the JSON object in the output
  const jsonMatch = output.match(/\{"numTotalTestSuites"\s*:/);
  if (!jsonMatch) {
    return undefined;
  }

  // Find the start of the JSON object
  const startIdx = output.indexOf(jsonMatch[0]);
  if (startIdx === -1) {
    return undefined;
  }

  // Try to parse from the start of the JSON object, skipping string literals
  let depth = 0;
  let endIdx = startIdx;
  let inString = false;
  for (let i = startIdx; i < output.length; i++) {
    const ch = output[i];
    if (inString) {
      if (ch === "\\" && i + 1 < output.length) {
        i++; // skip escaped character
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  try {
    const parsed = JSON.parse(output.slice(startIdx, endIdx)) as VitestJsonResult;
    const testDetails: TestDetail[] = [];
    for (const testResult of parsed.testResults ?? []) {
      for (const assertion of testResult.assertionResults ?? []) {
        const detail: TestDetail = {
          name: assertion.fullName,
          status: assertion.status === "passed" ? "passed" : "failed",
        };
        if (assertion.failureMessages.length > 0) {
          detail.failureMessage = assertion.failureMessages.join("\n");
        }
        testDetails.push(detail);
      }
    }
    return {
      passed: parsed.numPassedTests,
      total: parsed.numTotalTests,
      testDetails,
    };
  } catch {
    return undefined;
  }
}

function earlyReturn(
  generateStage: StageInput,
  skipReason: string,
  meta: ProblemMeta,
): StageInput[] {
  const skipped = `Skipped (${skipReason})`;
  return [
    generateStage,
    ...(meta.apiCheck ? [{ stage: "apiCheck" as const, passed: false, output: skipped }] : []),
    { stage: "typecheck", passed: false, output: skipped },
    { stage: "tests", passed: false, output: skipped },
  ];
}

/**
 * Run the three verification stages on a work directory.
 * Returns early only if generate fails; typecheck failure does not skip tests.
 */
export async function verifyProblem(
  workDir: string,
  meta: ProblemMeta,
  challengeRoot: string,
): Promise<StageInput[]> {
  // Stage 1: generate
  const sdkBin = path.join(challengeRoot, "..", "packages", "sdk", "dist", "cli", "index.mjs");
  if (!fs.existsSync(sdkBin)) {
    const msg = `SDK binary not found at ${sdkBin}. Run 'pnpm -C packages/sdk build' first.`;
    return earlyReturn({ stage: "generate", passed: false, output: msg }, "generate failed", meta);
  }
  const generateResult = await runCommand(`node "${sdkBin}" generate -c tailor.config.ts`, workDir);
  if (!generateResult.success) {
    // Partial scoring for generate: check what was accomplished
    const generateStage: StageInput = {
      stage: "generate",
      passed: false,
      output: generateResult.output,
      durationMs: generateResult.durationMs,
    };

    // Check file existence (20% of generate score)
    // For fix-broken problems (where all implement files are in scaffold), skip file existence
    // check since those files exist before any fix is applied -- awarding credit would inflate scores
    const newFiles = meta.files.implement.filter((f) => !meta.files.scaffold.includes(f));
    const isFixBroken = newFiles.length === 0;
    const allNewFilesExist =
      newFiles.length > 0 && newFiles.every((f) => fs.existsSync(path.join(workDir, f)));
    if (allNewFilesExist) {
      generateStage.testsPassed = GENERATE_PARTIAL_FILE_EXISTS;
    }

    // Import check (60% of generate score) -- runs for both new and fix-broken problems
    if (allNewFilesExist || isFixBroken) {
      generateStage.testsTotal = GENERATE_PARTIAL_TOTAL;
      const importCheck = await runCommand("npx tsc --noEmit", workDir);
      if (importCheck.success) {
        generateStage.testsPassed = GENERATE_PARTIAL_IMPORT_CHECK;
      }
    }

    return earlyReturn(generateStage, "generate failed", meta);
  }
  // Verify all required implementation files exist even when generate succeeds.
  // This catches fix-broken submissions that delete or rename required target files.
  const missingFiles = meta.files.implement.filter((f) => !fs.existsSync(path.join(workDir, f)));
  if (missingFiles.length > 0) {
    return earlyReturn(
      {
        stage: "generate",
        passed: false,
        output: `Generate succeeded but required files missing: ${missingFiles.join(", ")}`,
        durationMs: generateResult.durationMs,
        testsPassed: 0,
        testsTotal: GENERATE_PARTIAL_TOTAL,
      },
      "missing files",
      meta,
    );
  }

  const generateStage: StageInput = {
    stage: "generate",
    passed: true,
    output: generateResult.output,
    durationMs: generateResult.durationMs,
  };

  const apiCheckStage = runApiCheck(workDir, meta, challengeRoot);

  // Stage 2: typecheck
  const typecheckResult = await runCommand("npx tsc --noEmit", workDir);
  const typecheckStage: StageInput = {
    stage: "typecheck",
    passed: typecheckResult.success,
    output: typecheckResult.output,
    durationMs: typecheckResult.durationMs,
  };

  // Stage 3: tests (run even if typecheck failed for partial scoring)
  const problemDir = path.dirname(workDir);
  const testsDir = path.join(problemDir, "tests");
  const testResult = await runCommand(
    `npx vitest run --reporter=json --config "${path.join(challengeRoot, "vitest.config.ts")}" --root "${challengeRoot}" "${testsDir}"`,
    challengeRoot,
  );

  const testStage: StageInput = {
    stage: "tests",
    passed: testResult.success,
    output: testResult.output,
    durationMs: testResult.durationMs,
  };

  // Parse JSON output to extract individual test results
  const parsed = parseVitestJson(testResult.output);
  if (parsed) {
    testStage.testsPassed = parsed.passed;
    testStage.testsTotal = parsed.total;
    if (parsed.testDetails.length > 0) {
      testStage.testDetails = parsed.testDetails;
    }
    // Override pass/fail from parsed results: treat zero executed tests as failure
    testStage.passed = parsed.total > 0 && parsed.passed === parsed.total;
  }

  return [generateStage, ...(apiCheckStage ? [apiCheckStage] : []), typecheckStage, testStage];
}
