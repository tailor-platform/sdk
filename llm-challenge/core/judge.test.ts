import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type JudgeInput,
  type JudgeResult,
  computeWorkDiff,
  extractFailedTestOutput,
  extractJudgeJson,
  judgeFailure,
  readTraceEvents,
  resolveScaffoldLayers,
  setJudgeClientFactory,
  summarizeTraceForJudge,
} from "./judge";
import type { TraceEvent } from "./trace";

type MockResponse = { content: Array<{ type: string; text?: string }> };

function textResponse(text: string): MockResponse {
  return { content: [{ type: "text", text }] };
}

function makeInput(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    problemId: "m01",
    problemMd: "# m01\nWrite a unique field.",
    diff: "diff --git a/foo b/foo\n+x",
    traceEvents: [],
    failedTestOutput: "Test fails: expected X got Y",
    ...overrides,
  };
}

afterEach(() => {
  setJudgeClientFactory(null);
  vi.unstubAllEnvs();
});

describe("judgeFailure", () => {
  it("returns parsed result when the first response is valid JSON", async () => {
    const create = vi.fn().mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          affordanceLabel: "missing_action_verb",
          apiChange: "Make foo required.",
          docFallback: "Add an example.",
          diagnosis: "AI did not know foo existed.",
        }),
      ),
    );
    setJudgeClientFactory(() => ({ messages: { create } }));

    const result = await judgeFailure(makeInput());

    expect(result).toEqual({
      affordanceLabel: "missing_action_verb",
      apiChange: "Make foo required.",
      docFallback: "Add an example.",
      diagnosis: "AI did not know foo existed.",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first response is not valid JSON", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(textResponse("not json"))
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            affordanceLabel: "context_bloat",
            apiChange: "",
            docFallback: "",
            diagnosis: "Read too many d.ts files.",
          }),
        ),
      );
    setJudgeClientFactory(() => ({ messages: { create } }));

    const result = await judgeFailure(makeInput());

    expect(result.affordanceLabel).toBe("context_bloat");
    expect(create).toHaveBeenCalledTimes(2);
    // Second call should use the stricter system prompt.
    const secondCall = create.mock.calls[1]?.[0] as { system: string };
    expect(secondCall.system).toContain("IMPORTANT RETRY");
  });

  it("returns a placeholder when both calls fail to yield JSON", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(textResponse("still not json"))
      .mockResolvedValueOnce(textResponse("yet again not json"));
    setJudgeClientFactory(() => ({ messages: { create } }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await judgeFailure(makeInput());

    expect(result.affordanceLabel).toBe("uncategorized");
    expect(result.diagnosis).toContain("yet again not json");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("throws a descriptive error when ANTHROPIC_API_KEY is missing", async () => {
    // Use the real client path by clearing the factory override and unsetting the env var.
    setJudgeClientFactory(null);
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    await expect(judgeFailure(makeInput())).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("error message mentions both ANTHROPIC_API_KEY and the disable escape hatch", async () => {
    setJudgeClientFactory(null);
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    let err: unknown;
    try {
      await judgeFailure(makeInput());
    } catch (e) {
      err = e;
    }
    expect(String(err)).toContain("ANTHROPIC_API_KEY");
    expect(String(err)).toContain("LLM_CHALLENGE_DISABLE_JUDGE");
  });

  it("includes hypothesized affordance in the user prompt when provided", async () => {
    const create = vi.fn().mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          affordanceLabel: "missing_action_verb",
          apiChange: "",
          docFallback: "",
          diagnosis: "ok",
        }),
      ),
    );
    setJudgeClientFactory(() => ({ messages: { create } }));

    await judgeFailure(makeInput({ hypothesizedAffordance: "naming_bias" }));

    const firstCall = create.mock.calls[0]?.[0] as { messages: { content: string }[] };
    expect(firstCall.messages[0]?.content).toContain("hypothesizedAffordance: naming_bias");
  });

  it("survives missing optional fields in the model response", async () => {
    const create = vi.fn().mockResolvedValueOnce(
      textResponse(
        // Only affordanceLabel present — others should default to empty strings.
        JSON.stringify({ affordanceLabel: "implicit_assumption" }),
      ),
    );
    setJudgeClientFactory(() => ({ messages: { create } }));

    const result = await judgeFailure(makeInput());

    expect(result).toEqual({
      affordanceLabel: "implicit_assumption",
      apiChange: "",
      docFallback: "",
      diagnosis: "",
    });
  });
});

describe("extractJudgeJson", () => {
  it("parses a raw JSON object", () => {
    const raw = JSON.stringify({
      affordanceLabel: "ok",
      apiChange: "a",
      docFallback: "b",
      diagnosis: "c",
    });
    expect(extractJudgeJson(raw)).toEqual({
      affordanceLabel: "ok",
      apiChange: "a",
      docFallback: "b",
      diagnosis: "c",
    });
  });

  it("strips prose preamble around the JSON object", () => {
    const raw =
      'Here is the diagnosis:\n{"affordanceLabel":"context_bloat","apiChange":"","docFallback":"","diagnosis":"x"}\nThanks!';
    const result = extractJudgeJson(raw);
    expect(result?.affordanceLabel).toBe("context_bloat");
  });

  it("returns null when affordanceLabel is missing", () => {
    expect(extractJudgeJson('{"foo":"bar"}')).toBeNull();
  });

  it("returns null when no balanced object is present", () => {
    expect(extractJudgeJson("no json here")).toBeNull();
    expect(extractJudgeJson("")).toBeNull();
  });

  it("handles strings containing braces inside JSON", () => {
    const raw = '{"affordanceLabel":"x","apiChange":"a {b} c","docFallback":"","diagnosis":""}';
    expect(extractJudgeJson(raw)?.apiChange).toBe("a {b} c");
  });
});

describe("computeWorkDiff", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "judge-diff-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the empty string when both trees are identical", () => {
    const a = path.join(tempDir, "a");
    const b = path.join(tempDir, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, "file.ts"), "same\n");
    fs.writeFileSync(path.join(b, "file.ts"), "same\n");

    expect(computeWorkDiff(a, b)).toBe("");
  });

  it("returns a unified diff when files differ", () => {
    const a = path.join(tempDir, "scaffold");
    const b = path.join(tempDir, "work");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, "file.ts"), "old\n");
    fs.writeFileSync(path.join(b, "file.ts"), "new\n");

    const diff = computeWorkDiff(a, b);

    expect(diff).toContain("file.ts");
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
  });

  it("returns the empty string when one of the trees is missing", () => {
    const present = path.join(tempDir, "present");
    fs.mkdirSync(present);
    expect(computeWorkDiff(present, path.join(tempDir, "missing"))).toBe("");
    expect(computeWorkDiff(path.join(tempDir, "missing"), present)).toBe("");
  });

  it("captures added files in the diff", () => {
    const a = path.join(tempDir, "scaffold");
    const b = path.join(tempDir, "work");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, "new.ts"), "// added\n");

    const diff = computeWorkDiff(a, b);

    expect(diff).toContain("new.ts");
    expect(diff).toContain("+// added");
  });
});

describe("summarizeTraceForJudge", () => {
  function toolUse(name: string, input: Record<string, unknown>): TraceEvent {
    return { kind: "tool_use", name, input };
  }

  it("returns the empty string for an empty event list", () => {
    expect(summarizeTraceForJudge([])).toBe("");
  });

  it("formats Read and Bash events compactly with their primary arg", () => {
    const summary = summarizeTraceForJudge([
      toolUse("Read", { file_path: "tailordb/User.ts" }),
      toolUse("Bash", { command: "npx tsc --noEmit" }),
      toolUse("Edit", { file_path: "tailor.config.ts" }),
    ]);

    expect(summary).toContain("Read: tailordb/User.ts");
    expect(summary).toContain("Bash: npx tsc --noEmit");
    expect(summary).toContain("Edit: tailor.config.ts");
  });

  it("skips non-tool_use events when picking", () => {
    const events: TraceEvent[] = [
      { kind: "thinking", text: "thinking" },
      toolUse("Read", { file_path: "a.ts" }),
      { kind: "turn_summary", turnIndex: 0, inputTokens: 10 },
    ];
    const summary = summarizeTraceForJudge(events);
    expect(summary).toContain("Read: a.ts");
    expect(summary).not.toContain("thinking");
    expect(summary).not.toContain("turn_summary");
  });

  it("appends the result event when present", () => {
    const events: TraceEvent[] = [
      toolUse("Read", { file_path: "a.ts" }),
      { kind: "result", isError: true, text: "boom", costUsd: 0 },
    ];
    const summary = summarizeTraceForJudge(events);
    expect(summary).toContain("result isError=true");
    expect(summary).toContain("boom");
  });

  it("caps long traces at the last 50 tool_use events with a leading note", () => {
    const events: TraceEvent[] = [];
    for (let i = 0; i < 60; i++) {
      events.push(toolUse("Read", { file_path: `file-${i}.ts` }));
    }
    const summary = summarizeTraceForJudge(events);
    expect(summary).toContain("showing last 50 of 60");
    expect(summary).toContain("file-10.ts"); // first kept
    expect(summary).toContain("file-59.ts"); // last kept
    expect(summary).not.toContain("file-0.ts"); // dropped from head
    expect(summary).not.toContain("file-9.ts");
  });

  it("truncates long Bash commands to fit one line", () => {
    const longCmd = "x".repeat(500);
    const summary = summarizeTraceForJudge([toolUse("Bash", { command: longCmd })]);
    expect(summary.length).toBeLessThan(longCmd.length + 50);
    expect(summary).toContain("...");
  });
});

describe("extractFailedTestOutput", () => {
  it("returns the empty string when every stage passed", () => {
    expect(
      extractFailedTestOutput([
        { stage: "generate", passed: true, output: "ok" },
        { stage: "typecheck", passed: true, output: "ok" },
      ]),
    ).toBe("");
  });

  it("concatenates output of failed stages with stage labels", () => {
    const out = extractFailedTestOutput([
      { stage: "generate", passed: true, output: "fine" },
      { stage: "typecheck", passed: false, output: "TS2304: cannot find Foo" },
      { stage: "tests", passed: false, output: "test bar failed" },
    ]);

    expect(out).toContain("### stage: typecheck");
    expect(out).toContain("TS2304: cannot find Foo");
    expect(out).toContain("### stage: tests");
    expect(out).toContain("test bar failed");
    expect(out).not.toContain("fine");
  });

  it("truncates very long stage output to ~3000 chars", () => {
    const big = "x".repeat(10_000);
    const out = extractFailedTestOutput([{ stage: "tests", passed: false, output: big }]);
    expect(out.length).toBeLessThanOrEqual(3000);
    expect(out).toContain("truncated");
  });
});

describe("readTraceEvents", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "judge-trace-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns an empty array when the trace file is missing", () => {
    expect(readTraceEvents(path.join(tempDir, "missing.jsonl"))).toEqual([]);
  });

  it("parses each line of a JSONL trace into a typed event", () => {
    const tracePath = path.join(tempDir, "trace.jsonl");
    const lines: TraceEvent[] = [
      { kind: "tool_use", name: "Read", input: { file_path: "a.ts" } },
      { kind: "thinking", text: "..." },
      { kind: "result", isError: false, text: "done", costUsd: 0 },
    ];
    fs.writeFileSync(tracePath, lines.map((l) => JSON.stringify(l)).join("\n"));

    const events = readTraceEvents(tracePath);
    expect(events).toHaveLength(3);
    expect(events[0]?.kind).toBe("tool_use");
  });

  it("skips malformed lines and blank lines", () => {
    const tracePath = path.join(tempDir, "trace.jsonl");
    fs.writeFileSync(
      tracePath,
      [
        "",
        JSON.stringify({ kind: "tool_use", name: "Read", input: {} }),
        "not json",
        JSON.stringify({ kind: "tool_use", name: "Edit", input: {} }),
      ].join("\n"),
    );
    expect(readTraceEvents(tracePath)).toHaveLength(2);
  });
});

describe("resolveScaffoldLayers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "judge-layers-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("filters out missing layers", () => {
    const root = tempDir;
    const problemDir = path.join(root, "problems", "m01");
    fs.mkdirSync(path.join(root, "shared", "scaffold"), { recursive: true });
    // problems/_shared/scaffold intentionally missing
    fs.mkdirSync(path.join(problemDir, "scaffold"), { recursive: true });

    const layers = resolveScaffoldLayers(root, problemDir);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toContain("shared/scaffold");
    expect(layers[1]).toContain(`${path.sep}m01${path.sep}scaffold`);
  });
});

describe("JudgeResult snapshot contract", () => {
  it("uses the exact field shape consumed by report.ts", () => {
    const result: JudgeResult = {
      affordanceLabel: "x",
      apiChange: "y",
      docFallback: "z",
      diagnosis: "w",
    };
    // Compile-time guarantee that all four fields are required strings.
    expect(Object.keys(result).sort()).toEqual([
      "affordanceLabel",
      "apiChange",
      "diagnosis",
      "docFallback",
    ]);
  });
});

describe("computeWorkDiff exits via git plumbing", () => {
  it("does not throw when git is installed (smoke test)", () => {
    // Sanity: the helper relies on `git` being on PATH. If this fails in CI we
    // want to know early.
    expect(() => execFileSync("git", ["--version"], { stdio: "pipe" })).not.toThrow();
  });
});
