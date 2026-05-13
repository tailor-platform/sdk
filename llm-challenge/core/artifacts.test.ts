import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistSolveAttemptArtifact } from "./artifacts";
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

  it("writes empty transcript files when rawTranscript is missing", () => {
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "marker.txt"), "x");

    const result: SolveResult = {
      success: false,
      costUsd: 0,
      durationMs: 0,
      output: "no transcript",
    };

    const artifact = persistSolveAttemptArtifact({
      rootDir: path.join(tempDir, "artifacts"),
      attemptName: "attempt-0",
      result,
      workDir,
    });

    expect(fs.readFileSync(artifact.promptPath, "utf-8")).toBe("");
    expect(fs.readFileSync(artifact.stdoutPath, "utf-8")).toBe("");
    expect(fs.readFileSync(artifact.stderrPath, "utf-8")).toBe("");
  });

  it("overwrites an existing attempt artifact directory on rerun", () => {
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "fresh.ts"), "fresh\n");

    const rootDir = path.join(tempDir, "artifacts");
    // Pre-populate the attempt directory with a stale file that should be
    // removed by the next persist call. Without rmSync, stale snapshot files
    // would leak across reruns and corrupt the saved work tree.
    const attemptDir = path.join(rootDir, "attempt-0");
    fs.mkdirSync(path.join(attemptDir, "work"), { recursive: true });
    fs.writeFileSync(path.join(attemptDir, "work", "stale.ts"), "stale\n");

    const result: SolveResult = {
      success: true,
      costUsd: 0,
      durationMs: 0,
      output: "done",
    };

    const artifact = persistSolveAttemptArtifact({
      rootDir,
      attemptName: "attempt-0",
      result,
      workDir,
    });

    expect(fs.existsSync(path.join(artifact.workSnapshotDir, "fresh.ts"))).toBe(true);
    expect(fs.existsSync(path.join(artifact.workSnapshotDir, "stale.ts"))).toBe(false);
  });

  it("preserves symlinks in the work snapshot without dereferencing the target", () => {
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "target.ts"), "export const target = 1;\n");
    // The pnpm-link / tarball install path leaves symlinks behind. Snapshot
    // must keep them as symlinks (so the on-disk shape matches reality)
    // rather than copying through to the target file.
    fs.symlinkSync("target.ts", path.join(workDir, "alias.ts"));

    const result: SolveResult = {
      success: true,
      costUsd: 0,
      durationMs: 0,
      output: "done",
    };

    const artifact = persistSolveAttemptArtifact({
      rootDir: path.join(tempDir, "artifacts"),
      attemptName: "attempt-0",
      result,
      workDir,
    });

    const aliasStat = fs.lstatSync(path.join(artifact.workSnapshotDir, "alias.ts"));
    expect(aliasStat.isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(artifact.workSnapshotDir, "alias.ts"))).toBe("target.ts");
  });

  it("excludes node_modules and .sdk from the work snapshot", () => {
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

    const result: SolveResult = {
      success: true,
      costUsd: 0,
      durationMs: 0,
      output: "done",
    };

    const artifact = persistSolveAttemptArtifact({
      rootDir: path.join(tempDir, "artifacts"),
      attemptName: "attempt-0",
      result,
      workDir,
    });

    expect(
      fs.readFileSync(path.join(artifact.workSnapshotDir, "tailordb", "product.ts"), "utf-8"),
    ).toBe("export default {};\n");
    expect(fs.existsSync(path.join(artifact.workSnapshotDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(artifact.workSnapshotDir, ".sdk"))).toBe(false);
  });
});
