import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistFinalWorkSnapshot, persistSolveAttemptArtifact } from "./artifacts";
import type { SolveResult } from "./solve";

describe("persistSolveAttemptArtifact", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-artifacts-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes raw solve transcript and strips it from the reported result", () => {
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(path.join(workDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(workDir, "src", "model.ts"), "export const value = 1;\n");

    const result: SolveResult = {
      success: true,
      costUsd: 0.25,
      durationMs: 1234,
      output: "done",
      rawTranscript: {
        prompt: "Implement the task.",
        stdout: '{"type":"turn.completed"}\n',
        stderr: "warning\n",
      },
    };

    const artifact = persistSolveAttemptArtifact({
      rootDir: path.join(tempDir, "artifacts"),
      attemptName: "attempt-0",
      result,
      workDir,
    });

    expect(fs.readFileSync(artifact.promptPath, "utf-8")).toBe("Implement the task.");
    expect(fs.readFileSync(artifact.stdoutPath, "utf-8")).toBe('{"type":"turn.completed"}\n');
    expect(fs.readFileSync(artifact.stderrPath, "utf-8")).toBe("warning\n");
    expect(fs.existsSync(path.join(artifact.workSnapshotDir, "src", "model.ts"))).toBe(true);
    expect("rawTranscript" in result).toBe(false);
    expect(result.artifact).toEqual(artifact);
    expect(JSON.parse(fs.readFileSync(artifact.resultPath, "utf-8"))).toEqual(result);
  });
});

describe("persistFinalWorkSnapshot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-final-work-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies the final work tree without dependency artifacts", () => {
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(path.join(workDir, "tailordb"), { recursive: true });
    fs.mkdirSync(path.join(workDir, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(workDir, ".sdk"), { recursive: true });
    fs.writeFileSync(path.join(workDir, "tailordb", "product.ts"), "export default {};\n");
    fs.writeFileSync(
      path.join(workDir, "node_modules", "pkg", "index.js"),
      "module.exports = {};\n",
    );
    fs.writeFileSync(path.join(workDir, ".sdk", "sdk.tgz"), "tarball");

    const snapshotDir = persistFinalWorkSnapshot({
      rootDir: path.join(tempDir, "artifacts"),
      workDir,
    });

    expect(fs.readFileSync(path.join(snapshotDir, "tailordb", "product.ts"), "utf-8")).toBe(
      "export default {};\n",
    );
    expect(fs.existsSync(path.join(snapshotDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(snapshotDir, ".sdk"))).toBe(false);
  });
});
