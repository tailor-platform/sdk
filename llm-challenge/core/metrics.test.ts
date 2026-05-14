import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aggregateTraceMetrics,
  classifyReadTarget,
  computeLocStats,
  computeTraceMetrics,
  parseShortstat,
  READ_TARGET_CLASSES,
  type ReadTargetClass,
  summarizeMetrics,
  type TraceMetrics,
} from "./metrics";
import type { TraceEvent } from "./trace";

function toolUse(name: string, input: Record<string, unknown>): TraceEvent {
  return { kind: "tool_use", name, input };
}

function readFile(filePath: string): TraceEvent {
  return toolUse("Read", { file_path: filePath });
}

function bash(command: string): TraceEvent {
  return toolUse("Bash", { command });
}

function emptyReadTargets(): Record<ReadTargetClass, number> {
  return {
    "sdk-dts": 0,
    "sdk-package-src": 0,
    "sdk-docs": 0,
    "problem-files": 0,
    other: 0,
  };
}

/** Convenience: build a TraceMetrics literal for test assertions. */
function mkMetrics(partial: Partial<TraceMetrics>): TraceMetrics {
  return {
    turns: 0,
    toolUseCount: 0,
    toolCallCounts: {},
    readTargets: emptyReadTargets(),
    readSdkDts: 0,
    readDocs: 0,
    bashRetries: 0,
    ...partial,
  };
}

describe("classifyReadTarget", () => {
  it("classifies SDK .d.ts files as sdk-dts (declaration files)", () => {
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.d.ts")).toBe("sdk-dts");
    expect(
      classifyReadTarget("/workspace/node_modules/@tailor-platform/sdk/dist/plugin/x.d.ts"),
    ).toBe("sdk-dts");
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.d.mts")).toBe(
      "sdk-dts",
    );
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.d.cts")).toBe(
      "sdk-dts",
    );
  });

  it("classifies non-declaration SDK source files as sdk-package-src", () => {
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.js")).toBe(
      "sdk-package-src",
    );
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/cli/types.ts")).toBe(
      "sdk-package-src",
    );
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.mjs")).toBe(
      "sdk-package-src",
    );
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.cjs")).toBe(
      "sdk-package-src",
    );
  });

  it("classifies SDK .md, docs/, and README* paths as sdk-docs", () => {
    // SDK package .md file
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/README.md")).toBe("sdk-docs");
    // docs/ anywhere
    expect(classifyReadTarget("docs/architecture.md")).toBe("sdk-docs");
    expect(classifyReadTarget("packages/sdk/docs/changeset.md")).toBe("sdk-docs");
    expect(classifyReadTarget("/abs/path/docs/cli/tailordb.md")).toBe("sdk-docs");
    // README at any level
    expect(classifyReadTarget("README.md")).toBe("sdk-docs");
    expect(classifyReadTarget("packages/sdk/README")).toBe("sdk-docs");
    expect(classifyReadTarget("subdir/README_old.md")).toBe("sdk-docs");
  });

  it("classifies project-tree problem files as problem-files", () => {
    expect(classifyReadTarget("tests/foo.test.ts")).toBe("problem-files");
    expect(classifyReadTarget("/workspace/tests/foo.test.ts")).toBe("problem-files");
    expect(classifyReadTarget("tailor.config.ts")).toBe("problem-files");
    expect(classifyReadTarget("/workspace/tailor.config.ts")).toBe("problem-files");
    expect(classifyReadTarget("scaffold/tailor.config.ts")).toBe("problem-files");
    expect(classifyReadTarget("problems/m05/scaffold/tailordb/User.ts")).toBe("problem-files");
    expect(classifyReadTarget("problem.md")).toBe("problem-files");
    expect(classifyReadTarget("problems/m05/problem.md")).toBe("problem-files");
  });

  it("classifies remainder as other", () => {
    expect(classifyReadTarget("tailordb/User.ts")).toBe("other");
    expect(classifyReadTarget("package.json")).toBe("other");
    expect(classifyReadTarget("tsconfig.json")).toBe("other");
    expect(classifyReadTarget("pnpm-lock.yaml")).toBe("other");
    // node_modules NOT under tailor-platform sdk, non-d.ts
    expect(classifyReadTarget("node_modules/@types/node/fs.d.ts")).toBe("other");
    expect(classifyReadTarget("node_modules/typescript/lib/lib.d.ts")).toBe("other");
  });

  it("respects precedence: sdk-dts > sdk-package-src > sdk-docs > problem-files > other", () => {
    // A .d.ts inside the SDK package wins over the generic 'd.ts in node_modules' classification.
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/dist/index.d.ts")).toBe("sdk-dts");
    // A .ts inside the SDK package classifies as package-src even though tests/* also matches —
    // SDK package wins because it's checked first.
    expect(classifyReadTarget("node_modules/@tailor-platform/sdk/tests/x.ts")).toBe(
      "sdk-package-src",
    );
    // tests/ under node_modules (not under the SDK package) is NOT problem-files (the guard
    // explicitly excludes node_modules from problem-files).
    expect(classifyReadTarget("node_modules/other-pkg/tests/x.ts")).toBe("other");
    // docs/ anywhere wins over problem-files (docs/* is checked first).
    expect(classifyReadTarget("docs/scaffold/foo.md")).toBe("sdk-docs");
  });

  it("normalizes Windows backslashes for cross-platform classification", () => {
    expect(classifyReadTarget("node_modules\\@tailor-platform\\sdk\\dist\\index.d.ts")).toBe(
      "sdk-dts",
    );
    expect(classifyReadTarget("docs\\architecture.md")).toBe("sdk-docs");
  });
});

describe("aggregateTraceMetrics", () => {
  it("returns empty metrics for an empty trace", () => {
    expect(aggregateTraceMetrics([])).toEqual(mkMetrics({}));
  });

  it("counts tool_use events as turns and per-tool counts", () => {
    const metrics = aggregateTraceMetrics([
      readFile("a.ts"),
      readFile("b.ts"),
      toolUse("Edit", { file_path: "c.ts", old_string: "x", new_string: "y" }),
      bash("ls"),
      toolUse("Glob", { pattern: "**/*.ts" }),
    ]);

    expect(metrics.turns).toBe(5);
    expect(metrics.toolCallCounts).toEqual({
      Read: 2,
      Edit: 1,
      Bash: 1,
      Glob: 1,
    });
  });

  it("ignores non-tool_use events", () => {
    const events: TraceEvent[] = [
      { kind: "thinking", text: "considering" },
      { kind: "turn_summary", turnIndex: 0, inputTokens: 100 },
      readFile("a.ts"),
      { kind: "tool_result", ok: true },
      {
        kind: "result",
        isError: false,
        text: "done",
        costUsd: 0.1,
      },
    ];

    const metrics = aggregateTraceMetrics(events);
    expect(metrics.turns).toBe(1);
    expect(metrics.toolCallCounts).toEqual({ Read: 1 });
  });

  it("classifies Read events into the readTargets per-class map", () => {
    const metrics = aggregateTraceMetrics([
      readFile("node_modules/@tailor-platform/sdk/dist/index.d.ts"),
      readFile("node_modules/@tailor-platform/sdk/dist/plugin/kysely-type.d.ts"),
      readFile("node_modules/@tailor-platform/sdk/dist/cli/configure.js"),
      readFile("docs/architecture.md"),
      readFile("README.md"),
      readFile("tests/foo.test.ts"),
      readFile("tailor.config.ts"),
      readFile("package.json"),
    ]);
    expect(metrics.readTargets).toEqual({
      "sdk-dts": 2,
      "sdk-package-src": 1,
      "sdk-docs": 2,
      "problem-files": 2,
      other: 1,
    });
  });

  it("derives legacy readSdkDts / readDocs from the readTargets map", () => {
    const metrics = aggregateTraceMetrics([
      readFile("node_modules/@tailor-platform/sdk/dist/index.d.ts"),
      readFile("node_modules/@tailor-platform/sdk/dist/plugin/kysely-type.d.ts"),
      readFile("docs/architecture.md"),
      readFile("README.md"),
    ]);
    // Legacy fields are derived: match the new buckets exactly.
    expect(metrics.readSdkDts).toBe(metrics.readTargets["sdk-dts"]);
    expect(metrics.readSdkDts).toBe(2);
    expect(metrics.readDocs).toBe(metrics.readTargets["sdk-docs"]);
    expect(metrics.readDocs).toBe(2);
  });

  it("aggregates readTargets sums across many Read events", () => {
    const events = Array.from({ length: 10 }, () => readFile("docs/foo.md"));
    const metrics = aggregateTraceMetrics(events);
    expect(metrics.readTargets["sdk-docs"]).toBe(10);
    expect(metrics.readDocs).toBe(10);
  });

  it("counts Bash retries when commands hit known re-run patterns", () => {
    const metrics = aggregateTraceMetrics([
      bash("npx tsc --noEmit"),
      bash("npx vitest run"),
      bash("./node_modules/.bin/tailor-sdk generate -c tailor.config.ts"),
      bash("pnpm test"),
      // commands that should NOT count
      bash("ls"),
      bash("cat package.json"),
    ]);
    expect(metrics.bashRetries).toBe(4);
  });

  it("aggregates a longer mixed trace correctly", () => {
    const events: TraceEvent[] = [
      readFile("node_modules/@tailor-platform/sdk/dist/index.d.ts"),
      readFile("docs/architecture.md"),
      readFile("tailordb/User.ts"),
      toolUse("Edit", { file_path: "tailordb/User.ts" }),
      bash("npx tsc --noEmit"),
      bash("npx vitest run"),
      toolUse("Write", { file_path: "new.ts" }),
      readFile("node_modules/@tailor-platform/sdk/dist/cli/types.d.ts"),
    ];

    const metrics = aggregateTraceMetrics(events);
    expect(metrics.turns).toBe(8);
    expect(metrics.toolCallCounts).toEqual({
      Read: 4,
      Edit: 1,
      Bash: 2,
      Write: 1,
    });
    expect(metrics.readSdkDts).toBe(2);
    expect(metrics.readDocs).toBe(1);
    expect(metrics.bashRetries).toBe(2);
    expect(metrics.readTargets["sdk-dts"]).toBe(2);
    expect(metrics.readTargets["sdk-docs"]).toBe(1);
    expect(metrics.readTargets.other).toBe(1); // tailordb/User.ts
  });

  it("populates every readTargets bucket key even when unused", () => {
    const metrics = aggregateTraceMetrics([]);
    // All five buckets must be present (with zero value) so downstream code
    // does not need to gate on optional keys.
    for (const cls of READ_TARGET_CLASSES) {
      expect(metrics.readTargets[cls]).toBe(0);
    }
  });
});

describe("computeTraceMetrics", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-trace-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty metrics when the trace file does not exist", () => {
    const missing = path.join(tempDir, "missing.jsonl");
    expect(computeTraceMetrics(missing)).toEqual(mkMetrics({}));
  });

  it("parses a JSONL trace file and aggregates events", () => {
    const tracePath = path.join(tempDir, "trace.jsonl");
    const lines: TraceEvent[] = [
      { kind: "tool_use", name: "Read", input: { file_path: "docs/x.md" } },
      { kind: "thinking", text: "..." },
      {
        kind: "tool_use",
        name: "Read",
        input: { file_path: "node_modules/@tailor-platform/sdk/dist/index.d.ts" },
      },
      { kind: "tool_use", name: "Bash", input: { command: "npx tsc --noEmit" } },
    ];
    fs.writeFileSync(tracePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    const metrics = computeTraceMetrics(tracePath);
    expect(metrics.turns).toBe(3);
    expect(metrics.readDocs).toBe(1);
    expect(metrics.readSdkDts).toBe(1);
    expect(metrics.bashRetries).toBe(1);
    expect(metrics.readTargets["sdk-dts"]).toBe(1);
    expect(metrics.readTargets["sdk-docs"]).toBe(1);
  });

  it("tolerates malformed lines and blank lines", () => {
    const tracePath = path.join(tempDir, "trace.jsonl");
    const content = [
      "",
      JSON.stringify({ kind: "tool_use", name: "Read", input: { file_path: "a.ts" } }),
      "not json",
      JSON.stringify({ kind: "tool_use", name: "Edit", input: {} }),
      "",
    ].join("\n");
    fs.writeFileSync(tracePath, content);

    const metrics = computeTraceMetrics(tracePath);
    expect(metrics.turns).toBe(2);
    expect(metrics.toolCallCounts).toEqual({ Read: 1, Edit: 1 });
  });
});

describe("summarizeMetrics", () => {
  it("returns undefined for an empty list", () => {
    expect(summarizeMetrics([])).toBeUndefined();
  });

  it("computes min/max/median/mean per metric", () => {
    const summary = summarizeMetrics([
      mkMetrics({
        turns: 5,
        toolCallCounts: { Read: 3, Bash: 2 },
        readSdkDts: 1,
      }),
      mkMetrics({
        turns: 10,
        toolCallCounts: { Read: 6, Bash: 4 },
        readSdkDts: 2,
        readDocs: 1,
        bashRetries: 1,
      }),
      mkMetrics({
        turns: 15,
        toolCallCounts: { Read: 9, Bash: 6 },
        readSdkDts: 3,
        readDocs: 2,
        bashRetries: 2,
      }),
    ]);

    expect(summary).toBeDefined();
    expect(summary!.turns).toEqual({
      count: 3,
      min: 5,
      max: 15,
      median: 10,
      mean: 10,
    });
    expect(summary!.readSdkDts.median).toBe(2);
    expect(summary!.bashRetries.max).toBe(2);
    expect(summary!.toolCalls.Read).toEqual({
      count: 3,
      min: 3,
      max: 9,
      median: 6,
      mean: 6,
    });
  });

  it("treats absent tool counts as zero across runs", () => {
    const summary = summarizeMetrics([
      mkMetrics({ turns: 1, toolCallCounts: { Read: 1 } }),
      mkMetrics({ turns: 1, toolCallCounts: { Bash: 1 } }),
    ]);

    expect(summary!.toolCalls.Read).toEqual({
      count: 2,
      min: 0,
      max: 1,
      median: 0.5,
      mean: 0.5,
    });
    expect(summary!.toolCalls.Bash).toEqual({
      count: 2,
      min: 0,
      max: 1,
      median: 0.5,
      mean: 0.5,
    });
  });
});

describe("parseShortstat", () => {
  it("parses the full summary form: N files / M insertions / K deletions", () => {
    expect(parseShortstat(" 2 files changed, 5 insertions(+), 3 deletions(-)\n")).toEqual({
      filesChanged: 2,
      linesAdded: 5,
      linesRemoved: 3,
    });
  });

  it("parses the insertions-only form (no deletions clause)", () => {
    expect(parseShortstat(" 1 file changed, 11 insertions(+)\n")).toEqual({
      filesChanged: 1,
      linesAdded: 11,
      linesRemoved: 0,
    });
  });

  it("parses the deletions-only form (no insertions clause)", () => {
    expect(parseShortstat(" 1 file changed, 4 deletions(-)\n")).toEqual({
      filesChanged: 1,
      linesAdded: 0,
      linesRemoved: 4,
    });
  });

  it("returns zeros on an empty / non-shortstat string", () => {
    expect(parseShortstat("")).toEqual({ filesChanged: 0, linesAdded: 0, linesRemoved: 0 });
    expect(parseShortstat("warning: foo\n")).toEqual({
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
  });
});

describe("computeLocStats", () => {
  let baseDir: string;
  let workDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-loc-base-"));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-loc-work-"));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("returns zeros when one of the two directories does not exist", () => {
    fs.rmSync(workDir, { recursive: true, force: true });
    expect(computeLocStats(baseDir, workDir)).toEqual({
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
  });

  it("counts insertions vs deletions correctly against a baseline tree", () => {
    fs.writeFileSync(path.join(baseDir, "a.ts"), "line1\nline2\nline3\n");
    fs.writeFileSync(path.join(workDir, "a.ts"), "line1\nline2_changed\nline3\nline4_new\n");
    const result = computeLocStats(baseDir, workDir);
    expect(result.filesChanged).toBe(1);
    expect(result.linesAdded).toBeGreaterThan(0);
    expect(result.linesRemoved).toBeGreaterThan(0);
  });

  it("returns zeros when both trees are identical", () => {
    fs.writeFileSync(path.join(baseDir, "a.ts"), "hello\n");
    fs.writeFileSync(path.join(workDir, "a.ts"), "hello\n");
    expect(computeLocStats(baseDir, workDir)).toEqual({
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
  });
});
