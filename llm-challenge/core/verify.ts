import type { ExecException } from "node:child_process";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ProblemMeta } from "./cli";

const execAsync = promisify(exec);

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

export type ChallengeStage = "generate" | "typecheck" | "tests";

export type StageInput = {
  stage: ChallengeStage;
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
  env?: NodeJS.ProcessEnv,
): Promise<{ success: boolean; output: string; durationMs: number }> {
  const start = performance.now();
  try {
    const { stdout } = await execAsync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      ...(env !== undefined ? { env } : {}),
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
  if (!jsonMatch || jsonMatch.index === undefined) {
    return undefined;
  }
  const startIdx = jsonMatch.index;

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

function earlyReturn(generateStage: StageInput, skipReason: string): StageInput[] {
  const skipped = `Skipped (${skipReason})`;
  return [
    generateStage,
    { stage: "typecheck", passed: false, output: skipped },
    { stage: "tests", passed: false, output: skipped },
  ];
}

/**
 * Run the three verification stages on a work directory.
 * Returns early only if generate fails; typecheck failure does not skip tests.
 *
 * Binary pass/fail per stage — no partial credit.
 */
export async function verifyProblem(
  workDir: string,
  problemDir: string,
  meta: ProblemMeta,
  challengeRoot: string,
): Promise<StageInput[]> {
  // Stage 1: generate
  const sdkBin = path.join(challengeRoot, "..", "packages", "sdk", "dist", "cli", "index.mjs");
  if (!fs.existsSync(sdkBin)) {
    const msg = `SDK binary not found at ${sdkBin}. Run 'pnpm -C packages/sdk build' first.`;
    return earlyReturn({ stage: "generate", passed: false, output: msg }, "generate failed");
  }
  const generateResult = await runCommand(`node "${sdkBin}" generate -c tailor.config.ts`, workDir);
  if (!generateResult.success) {
    return earlyReturn(
      {
        stage: "generate",
        passed: false,
        output: generateResult.output,
        durationMs: generateResult.durationMs,
      },
      "generate failed",
    );
  }
  // Verify all required implementation files exist even when generate succeeds.
  // This catches submissions that delete or rename required target files.
  // Phase 2 micro-problems omit `meta.files`; rely on the test stage to detect
  // missing output instead.
  const required = meta.files?.implement ?? [];
  const missingFiles = required.filter((f) => !fs.existsSync(path.join(workDir, f)));
  if (missingFiles.length > 0) {
    return earlyReturn(
      {
        stage: "generate",
        passed: false,
        output: `Generate succeeded but required files missing: ${missingFiles.join(", ")}`,
        durationMs: generateResult.durationMs,
      },
      "missing files",
    );
  }

  const generateStage: StageInput = {
    stage: "generate",
    passed: true,
    output: generateResult.output,
    durationMs: generateResult.durationMs,
  };

  // Stage 2: typecheck
  const typecheckResult = await runCommand("npx tsc --noEmit", workDir);
  const typecheckStage: StageInput = {
    stage: "typecheck",
    passed: typecheckResult.success,
    output: typecheckResult.output,
    durationMs: typecheckResult.durationMs,
  };

  // Stage 3: tests (run even if typecheck failed)
  // In solve mode workDir is a per-run tmpdir; export it so the test helper's
  // createWorkDirContext() reads the freshly-solved tree instead of a stale
  // problems/<id>/work left over from earlier runs.
  const testsDir = path.join(problemDir, "tests");
  const testResult = await runCommand(
    `npx vitest run --reporter=json --config "${path.join(challengeRoot, "vitest.config.ts")}" --root "${challengeRoot}" "${testsDir}"`,
    challengeRoot,
    { ...process.env, LLM_CHALLENGE_WORK_DIR: workDir },
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

  return [generateStage, typecheckStage, testStage];
}
