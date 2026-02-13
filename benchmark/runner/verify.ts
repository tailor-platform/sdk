import { execSync } from "node:child_process";
import path from "node:path";
import type { ProblemMeta } from "../shared/helpers";

type StageInput = {
  stage: "generate" | "typecheck" | "tests";
  passed: boolean;
  output: string;
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

/**
 * Run the three verification stages on a work directory.
 * Returns early (skipping later stages) if an earlier stage fails.
 */
export function verifyProblem(
  workDir: string,
  _meta: ProblemMeta,
  benchmarkRoot: string,
): StageInput[] {
  const results: StageInput[] = [];

  // Stage 1: generate
  const sdkBin = path.join(benchmarkRoot, "..", "packages", "sdk", "dist", "cli", "index.mjs");
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

  // Stage 3: tests
  const problemId = path.basename(workDir).replace(/^work-?/, "");
  const testsDir = path.join(benchmarkRoot, "problems", problemId, "tests");
  const testResult = runCommand(
    `npx vitest run --config ${path.join(benchmarkRoot, "vitest.config.ts")} --root ${benchmarkRoot} ${testsDir}`,
    workDir,
  );
  results.push({
    stage: "tests",
    passed: testResult.success,
    output: testResult.output,
  });

  return results;
}
