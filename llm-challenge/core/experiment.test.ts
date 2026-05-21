import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ITERATIONS, buildChildArgs, findLatestReport, parseArgs } from "./experiment";

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
    fs.mkdirSync(path.join(tempDir, "oss-gpt-oss-types"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "solution-types"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "oss-gpt-oss-types", "report-1.json"), "{}");
    fs.writeFileSync(path.join(tempDir, "solution-types", "report-2.json"), "{}");

    const result = findLatestReport(tempDir, "oss-", new Date(0));
    expect(result).toBeDefined();
    expect(result).toContain("oss-gpt-oss-types");
    expect(result).not.toContain("solution-types");
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

describe("DEFAULT_ITERATIONS", () => {
  it("is 5 (Phase 5c bumped the default from 3 to keep variance tight)", () => {
    // This is intentionally a literal assertion: bumping the default again
    // should be a deliberate decision documented in the README + CHANGELOG.
    expect(DEFAULT_ITERATIONS).toBe(5);
  });
});

describe("parseArgs", () => {
  let originalArgv: string[];
  beforeEach(() => {
    originalArgv = process.argv;
  });
  afterEach(() => {
    process.argv = originalArgv;
  });

  function setArgv(args: string[]): void {
    process.argv = ["node", "experiment.ts", ...args];
  }

  it("defaults iterations to DEFAULT_ITERATIONS when --iterations is omitted", () => {
    setArgv(["--sdk-branch", "feat/foo"]);
    const args = parseArgs();
    expect(args.iterations).toBe(DEFAULT_ITERATIONS);
  });

  it("parses --problems as a comma-separated list and strips whitespace", () => {
    setArgv(["--sdk-branch", "feat/foo", "--problems", "m05, m18 ,m07"]);
    const args = parseArgs();
    expect(args.problems).toEqual(["m05", "m18", "m07"]);
  });

  it("exits when --problems is empty (empty string between commas only)", () => {
    setArgv(["--sdk-branch", "feat/foo", "--problems", ", ,"]);
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => parseArgs()).toThrow(/exit:1/);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("at least one problem ID"));
    exit.mockRestore();
    err.mockRestore();
  });

  it("strips --problems out of the forwarded args (reserved by the experiment driver)", () => {
    setArgv([
      "--sdk-branch",
      "feat/foo",
      "--problems",
      "m05",
      "--context-profile",
      "code-only",
      "--no-early-stop",
    ]);
    const args = parseArgs();
    expect(args.problems).toEqual(["m05"]);
    expect(args.forward).toEqual(["--context-profile", "code-only", "--no-early-stop"]);
    // Must not leak the reserved flag downstream.
    expect(args.forward).not.toContain("--problems");
  });
});

describe("buildChildArgs", () => {
  it("emits --solve --iterations <n> and forwards extra args verbatim", () => {
    const args = buildChildArgs(5, ["--context-profile", "code-only", "--no-early-stop"]);
    expect(args).toEqual([
      "--solve",
      "--iterations",
      "5",
      "--context-profile",
      "code-only",
      "--no-early-stop",
    ]);
  });

  it("appends --sdk-branch <ref> when set", () => {
    const args = buildChildArgs(3, [], { sdkBranch: "feat/exec-description-required" });
    expect(args).toEqual([
      "--solve",
      "--iterations",
      "3",
      "--sdk-branch",
      "feat/exec-description-required",
    ]);
  });

  it("expands a problems[] list as multiple --problem <id> flags", () => {
    const args = buildChildArgs(5, [], { problems: ["m05", "m18"] });
    // The test asserts a specific order so child argv composition stays
    // deterministic; if you change buildChildArgs ordering you must update
    // every cli.ts caller that relies on the cli precedence.
    expect(args).toEqual(["--solve", "--iterations", "5", "--problem", "m05", "--problem", "m18"]);
  });

  it("supports both --sdk-branch and --problems at once", () => {
    const args = buildChildArgs(5, ["--context-profile", "code-only"], {
      sdkBranch: "feat/foo",
      problems: ["m05", "m18"],
    });
    expect(args).toEqual([
      "--solve",
      "--iterations",
      "5",
      "--sdk-branch",
      "feat/foo",
      "--problem",
      "m05",
      "--problem",
      "m18",
      "--context-profile",
      "code-only",
    ]);
  });

  it("omits --problem flags when the problems list is empty", () => {
    const args = buildChildArgs(5, [], { problems: [] });
    expect(args).toEqual(["--solve", "--iterations", "5"]);
  });
});
