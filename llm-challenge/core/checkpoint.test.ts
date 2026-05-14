import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCheckpoint,
  checkpointPath,
  deleteCheckpoint,
  groupCheckpoint,
  isCheckpointReusable,
  readCheckpoint,
} from "./checkpoint";
import type { ProblemResult } from "./report";

const makeResult = (problemId: string, passed: boolean, infra = false): ProblemResult => ({
  problemId,
  problemName: problemId,
  difficulty: "easy",
  category: "micro",
  contextProfile: "full-package",
  stages: [],
  passed,
  solveResult: {
    success: passed,
    costUsd: 0,
    durationMs: 0,
    output: "",
    infraFailure: infra,
  },
  totalDurationMs: 0,
});

describe("checkpoint", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-checkpoint-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("appendCheckpoint + readCheckpoint round-trip", () => {
    const file = checkpointPath(tempDir, "run-1");
    appendCheckpoint(file, { problemName: "m01", iter: 0, result: makeResult("m01", true) });
    appendCheckpoint(file, { problemName: "m01", iter: 1, result: makeResult("m01", false) });
    const entries = readCheckpoint(file);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.problemName).toBe("m01");
    expect(entries[0]?.iter).toBe(0);
    expect(entries[1]?.iter).toBe(1);
  });

  it("readCheckpoint returns [] for missing file", () => {
    expect(readCheckpoint(checkpointPath(tempDir, "nonexistent"))).toEqual([]);
  });

  it("readCheckpoint tolerates a malformed final line (interrupted write)", () => {
    const file = checkpointPath(tempDir, "run-2");
    appendCheckpoint(file, { problemName: "m01", iter: 0, result: makeResult("m01", true) });
    // Append a malformed trailing line that an interrupted process might leave.
    fs.appendFileSync(file, "{not valid json\n");
    const entries = readCheckpoint(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.iter).toBe(0);
  });

  it("groupCheckpoint indexes by (problemName, iter), later entries win", () => {
    const file = checkpointPath(tempDir, "run-3");
    appendCheckpoint(file, { problemName: "m01", iter: 0, result: makeResult("m01", false, true) });
    appendCheckpoint(file, { problemName: "m01", iter: 0, result: makeResult("m01", true) });
    appendCheckpoint(file, { problemName: "m02", iter: 0, result: makeResult("m02", true) });
    const grouped = groupCheckpoint(readCheckpoint(file));
    expect(grouped.get("m01")?.get(0)?.passed).toBe(true); // later entry wins
    expect(grouped.get("m02")?.get(0)?.passed).toBe(true);
  });

  it("isCheckpointReusable: passed=true reusable, infra=true NOT reusable", () => {
    expect(isCheckpointReusable(makeResult("m01", true))).toBe(true);
    expect(isCheckpointReusable(makeResult("m01", false))).toBe(true); // real fail
    expect(isCheckpointReusable(makeResult("m01", false, true))).toBe(false); // infra
  });

  it("deleteCheckpoint removes the file silently when absent", () => {
    const file = checkpointPath(tempDir, "absent");
    expect(() => deleteCheckpoint(file)).not.toThrow();
    appendCheckpoint(file, { problemName: "m01", iter: 0, result: makeResult("m01", true) });
    expect(fs.existsSync(file)).toBe(true);
    deleteCheckpoint(file);
    expect(fs.existsSync(file)).toBe(false);
  });
});
