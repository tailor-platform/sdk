import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateTraceMetrics, computeTraceMetrics, summarizeMetrics } from "./metrics";
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

describe("aggregateTraceMetrics", () => {
  it("returns empty metrics for an empty trace", () => {
    expect(aggregateTraceMetrics([])).toEqual({
      turns: 0,
      toolCallCounts: {},
      readSdkDts: 0,
      readDocs: 0,
      bashRetries: 0,
    });
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

  it("counts Read of SDK .d.ts via the dedicated bucket", () => {
    const metrics = aggregateTraceMetrics([
      readFile("node_modules/@tailor-platform/sdk/dist/index.d.ts"),
      readFile("node_modules/@tailor-platform/sdk/dist/plugin/kysely-type.d.ts"),
      // non-d.ts in same package: should NOT count
      readFile("node_modules/@tailor-platform/sdk/dist/index.js"),
      // different package .d.ts: should NOT count
      readFile("node_modules/@types/node/fs.d.ts"),
      // direct project file: should NOT count
      readFile("tailor.config.ts"),
    ]);
    expect(metrics.readSdkDts).toBe(2);
  });

  it("counts Read of docs/ and README files via the dedicated bucket", () => {
    const metrics = aggregateTraceMetrics([
      readFile("docs/architecture.md"),
      readFile("docs/cli/tailordb.md"),
      readFile("README.md"),
      readFile("packages/sdk/README"),
      // non-docs: should NOT count
      readFile("tailor.config.ts"),
      // documentation in a subpath: should count via /docs/
      readFile("packages/sdk/docs/changeset.md"),
    ]);
    expect(metrics.readDocs).toBe(5);
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
    expect(computeTraceMetrics(missing)).toEqual({
      turns: 0,
      toolCallCounts: {},
      readSdkDts: 0,
      readDocs: 0,
      bashRetries: 0,
    });
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
      {
        turns: 5,
        toolCallCounts: { Read: 3, Bash: 2 },
        readSdkDts: 1,
        readDocs: 0,
        bashRetries: 0,
      },
      {
        turns: 10,
        toolCallCounts: { Read: 6, Bash: 4 },
        readSdkDts: 2,
        readDocs: 1,
        bashRetries: 1,
      },
      {
        turns: 15,
        toolCallCounts: { Read: 9, Bash: 6 },
        readSdkDts: 3,
        readDocs: 2,
        bashRetries: 2,
      },
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
      {
        turns: 1,
        toolCallCounts: { Read: 1 },
        readSdkDts: 0,
        readDocs: 0,
        bashRetries: 0,
      },
      {
        turns: 1,
        toolCallCounts: { Bash: 1 },
        readSdkDts: 0,
        readDocs: 0,
        bashRetries: 0,
      },
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
