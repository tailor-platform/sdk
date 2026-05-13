import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPrompt } from "./solve";
import { parseClaudeJsonOutput } from "./solver/claude";
import { estimateCodexUsageCostUsd, parseCodexJsonlOutput } from "./solver/codex";

describe("parseClaudeJsonOutput", () => {
  it("parses successful Claude JSON output", () => {
    const output = JSON.stringify({
      result: "done",
      is_error: false,
      total_cost_usd: 0.0123,
      duration_ms: 1234,
    });

    expect(parseClaudeJsonOutput(output)).toEqual({
      parsed: true,
      isError: false,
      result: "done",
      costUsd: 0.0123,
      durationMs: 1234,
    });
  });

  it("extracts usage when Claude JSON output includes per-turn token stats", () => {
    const output = JSON.stringify({
      result: "done",
      is_error: false,
      total_cost_usd: 0.05,
      duration_ms: 9000,
      num_turns: 12,
      usage: {
        input_tokens: 1500,
        output_tokens: 800,
        cache_read_input_tokens: 20000,
        cache_creation_input_tokens: 4000,
      },
    });

    expect(parseClaudeJsonOutput(output).usage).toEqual({
      inputTokens: 1500,
      outputTokens: 800,
      cacheReadTokens: 20000,
      numTurns: 12,
    });
  });

  it("omits usage when neither usage nor num_turns are present", () => {
    const output = JSON.stringify({
      result: "ok",
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 0,
    });

    expect(parseClaudeJsonOutput(output).usage).toBeUndefined();
  });

  it("captures numTurns even when the usage block is missing", () => {
    const output = JSON.stringify({
      result: "ok",
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 0,
      num_turns: 4,
    });

    expect(parseClaudeJsonOutput(output).usage).toEqual({ numTurns: 4 });
  });

  it("returns parsed=false for non-JSON output", () => {
    expect(parseClaudeJsonOutput("not-json")).toEqual({
      parsed: false,
      isError: true,
      result: "not-json",
      costUsd: 0,
    });
  });
});

describe("parseCodexJsonlOutput", () => {
  it("extracts final agent message and usage from successful Codex JSONL", () => {
    const output = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"implemented"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}',
    ].join("\n");

    expect(parseCodexJsonlOutput(output)).toEqual({
      success: true,
      message: "implemented",
      error: undefined,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
      },
      numTurns: 1,
    });
  });

  it("counts turn.completed events across multi-turn Codex runs", () => {
    const output = [
      '{"type":"turn.started"}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final"}}',
      '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":7}}',
    ].join("\n");

    const parsed = parseCodexJsonlOutput(output);
    expect(parsed.numTurns).toBe(2);
    // The usage from the LAST turn wins; this is documented behavior.
    expect(parsed.usage).toEqual({ inputTokens: 20, cachedInputTokens: 5, outputTokens: 7 });
  });

  it("marks output as failure when turn.failed is present", () => {
    const output = [
      '{"type":"turn.started"}',
      '{"type":"error","message":"authentication failed"}',
      '{"type":"turn.failed","error":{"message":"authentication failed"}}',
    ].join("\n");

    expect(parseCodexJsonlOutput(output)).toEqual({
      success: false,
      message: "",
      error: "authentication failed",
      usage: undefined,
    });
  });
});

describe("estimateCodexUsageCostUsd", () => {
  it("estimates USD cost from usage", () => {
    const cost = estimateCodexUsageCostUsd({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
    });

    expect(cost).toBeCloseTo(0.0004025, 10);
  });

  it("returns 0 when usage is missing", () => {
    expect(estimateCodexUsageCostUsd(undefined)).toBe(0);
  });
});

describe("buildPrompt", () => {
  const tmpDirs: string[] = [];

  function makeFixture(opts: {
    problem: string;
    scaffoldFiles: Record<string, string>;
    scaffold: string[];
    implement: string[];
  }): { problemDir: string; workDir: string; meta: Parameters<typeof buildPrompt>[1] } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llm-buildprompt-"));
    tmpDirs.push(root);
    const problemDir = path.join(root, "problem");
    const workDir = path.join(root, "work");
    fs.mkdirSync(problemDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(problemDir, "problem.md"), opts.problem);
    for (const [rel, body] of Object.entries(opts.scaffoldFiles)) {
      const full = path.join(workDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    const meta = {
      id: "999",
      name: "fixture",
      difficulty: "easy",
      category: "api-design",
      files: { implement: opts.implement, scaffold: opts.scaffold },
    } as Parameters<typeof buildPrompt>[1];
    return { problemDir, workDir, meta };
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses implement mode when no scaffold overlaps the implement files", () => {
    const { problemDir, workDir, meta } = makeFixture({
      problem: "Build the thing.",
      scaffoldFiles: { "package.json": "{}\n" },
      scaffold: [],
      implement: ["resolvers/a.ts"],
    });

    const prompt = buildPrompt(problemDir, meta, workDir, "full-package");

    // System block describes "create" mode.
    expect(prompt).toContain(
      "Create ONLY the files listed in the task. Do NOT modify existing files.",
    );
    // Must NOT include fix-mode phrasing.
    expect(prompt).not.toContain("Fix the issues in the listed files");
    expect(prompt).not.toContain("Some files already exist and need to be fixed");
    // Single "Files to Create" group, no "Files to Fix" group.
    expect(prompt).toContain("## Files to Create");
    expect(prompt).not.toContain("## Files to Fix");
    expect(prompt).toContain("- resolvers/a.ts");
    // Problem body is included.
    expect(prompt).toContain("Build the thing.");
  });

  it("uses fix mode when every implement file already exists in scaffold", () => {
    const { problemDir, workDir, meta } = makeFixture({
      problem: "Fix the broken resolver.",
      scaffoldFiles: { "resolvers/a.ts": "// broken\n" },
      scaffold: ["resolvers/a.ts"],
      implement: ["resolvers/a.ts"],
    });

    const prompt = buildPrompt(problemDir, meta, workDir, "full-package");

    // System block describes "fix" mode.
    expect(prompt).toContain(
      "Fix the issues in the listed files. Read the existing files first, then modify them.",
    );
    // Must NOT include implement-only or hybrid phrasings.
    expect(prompt).not.toContain("Create ONLY the files listed in the task");
    expect(prompt).not.toContain("Some files already exist and need to be fixed");
    // Single "Files to Fix" group, no "Files to Create" group.
    expect(prompt).toContain("## Files to Fix");
    expect(prompt).not.toContain("## Files to Create");
    expect(prompt).toContain("- resolvers/a.ts");
  });

  it("uses hybrid mode when implement has both pre-existing and new files", () => {
    const { problemDir, workDir, meta } = makeFixture({
      problem: "Fix one resolver and add another.",
      scaffoldFiles: { "resolvers/a.ts": "// broken\n" },
      scaffold: ["resolvers/a.ts"],
      implement: ["resolvers/a.ts", "resolvers/b.ts"],
    });

    const prompt = buildPrompt(problemDir, meta, workDir, "full-package");

    // System block describes hybrid mode.
    expect(prompt).toContain(
      "Some files already exist and need to be fixed; other files must be created from scratch.",
    );
    expect(prompt).toContain('For "Files to Fix": read and modify existing files.');
    expect(prompt).toContain('For "Files to Create": create new files.');
    // Must NOT include pure-implement or pure-fix phrasings.
    expect(prompt).not.toContain("Create ONLY the files listed in the task");
    expect(prompt).not.toContain(
      "Fix the issues in the listed files. Read the existing files first, then modify them.",
    );
    // Two distinct sections.
    expect(prompt).toContain("## Files to Fix");
    expect(prompt).toContain("## Files to Create");
    // Each file appears in exactly one group.
    const fixIdx = prompt.indexOf("## Files to Fix");
    const createIdx = prompt.indexOf("## Files to Create");
    expect(fixIdx).toBeLessThan(createIdx);
    const fixSection = prompt.slice(fixIdx, createIdx);
    const createSection = prompt.slice(createIdx);
    expect(fixSection).toContain("- resolvers/a.ts");
    expect(fixSection).not.toContain("- resolvers/b.ts");
    expect(createSection).toContain("- resolvers/b.ts");
    expect(createSection).not.toContain("- resolvers/a.ts");
  });
});
