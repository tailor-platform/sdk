import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findLatestReport } from "./experiment";

describe("findLatestReport", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-find-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns undefined when the results directory does not exist", () => {
    expect(findLatestReport(path.join(tempDir, "missing"), "", new Date())).toBeUndefined();
  });

  it("returns undefined when no report-*.json files exist", () => {
    fs.mkdirSync(path.join(tempDir, "run-a"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "run-a", "not-a-report.json"), "{}");
    expect(findLatestReport(tempDir, "", new Date(0))).toBeUndefined();
  });

  it("ignores reports whose mtime is older than startedAt", () => {
    fs.mkdirSync(path.join(tempDir, "run-a"), { recursive: true });
    const reportPath = path.join(tempDir, "run-a", "report-old.json");
    fs.writeFileSync(reportPath, "{}");
    // Pin mtime to the past.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(reportPath, past, past);

    const startedAt = new Date(); // strictly after past
    expect(findLatestReport(tempDir, "", startedAt)).toBeUndefined();
  });

  it("filters out subdirectories that do not start with labelPrefix", () => {
    fs.mkdirSync(path.join(tempDir, "claude-haiku-types"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "codex-types"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "claude-haiku-types", "report-1.json"), "{}");
    fs.writeFileSync(path.join(tempDir, "codex-types", "report-2.json"), "{}");

    const result = findLatestReport(tempDir, "claude-", new Date(0));
    expect(result).toBeDefined();
    expect(result).toContain("claude-haiku-types");
    expect(result).not.toContain("codex-types");
  });

  it("returns the newest report by mtime when multiple match", () => {
    fs.mkdirSync(path.join(tempDir, "run-a"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "run-b"), { recursive: true });
    const older = path.join(tempDir, "run-a", "report-1.json");
    const newer = path.join(tempDir, "run-b", "report-2.json");
    fs.writeFileSync(older, "{}");
    fs.writeFileSync(newer, "{}");

    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(older, past, past);
    // newer keeps current mtime

    const result = findLatestReport(tempDir, "", new Date(Date.now() - 120_000));
    expect(result).toBe(newer);
  });

  it("ignores plain files at the top level of the results dir", () => {
    // Only subdirectories are scanned; a stray report-*.json at the top must
    // not blow up readdirSync(... withFileTypes: true) routing.
    fs.writeFileSync(path.join(tempDir, "report-stray.json"), "{}");
    expect(findLatestReport(tempDir, "", new Date(0))).toBeUndefined();
  });
});
