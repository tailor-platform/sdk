import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { findServedModelMismatches, isSameClaudeModel, summarizeClaudeTrace } from "./claude-trace";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function readFixture(name: string): Promise<unknown[]> {
  const text = await fs.readFile(path.join(fixturesDir, name), "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

describe("claude trace summary", () => {
  test("pairs Bash tool calls with their results and exit codes", async () => {
    const summary = summarizeClaudeTrace(await readFixture("claude-stream-failing-command.jsonl"));

    expect(summary.commands).toEqual([
      {
        command: 'sh -c "echo out; echo err >&2; exit 3"',
        exitCode: 3,
        status: "failed",
        output: "Exit code 3\nout\nerr",
      },
      { command: "echo fine", exitCode: 0, status: "completed", output: "fine" },
    ]);
    expect(summary.toolCalls).toBe(2);
    expect(summary.claudeCodeVersion).toBe("2.1.289");
    expect(summary.requestedModel).toBe("claude-haiku-4-5");
    expect(summary.servedModels).toEqual(["claude-haiku-4-5-20251001"]);
    expect(summary.result).toMatchObject({
      subtype: "success",
      isError: false,
      numTurns: 3,
      apiErrorStatus: null,
    });
    expect(summary.result?.totalCostUsd).toBeGreaterThan(0);
    expect(summary.rateLimitRejected).toBe(false);
  });

  test("includes subagent commands and counts every tool call", async () => {
    const summary = summarizeClaudeTrace(await readFixture("claude-stream-subagent.jsonl"));

    expect(summary.commands.map((command) => command.command)).toEqual([
      "echo from-sub",
      "echo from-main",
    ]);
    expect(summary.commands.every((command) => command.exitCode === 0)).toBe(true);
    expect(summary.toolCalls).toBe(3);
    expect(summary.servedModels).toEqual(["claude-haiku-4-5-20251001"]);
  });

  test("marks a tool call without a result as incomplete", () => {
    const summary = summarizeClaudeTrace([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          model: "claude-opus-5-5",
          content: [
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "sleep 99" } },
          ],
        },
      },
    ]);

    expect(summary.commands).toEqual([{ command: "sleep 99", status: "incomplete" }]);
    expect(summary.result).toBeUndefined();
  });

  test("detects rejected rate limit events and API errors", () => {
    const summary = summarizeClaudeTrace([
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
      },
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        api_error_status: 429,
        num_turns: 1,
      },
    ]);

    expect(summary.rateLimitRejected).toBe(true);
    expect(summary.result).toMatchObject({ isError: true, apiErrorStatus: 429 });
  });

  test("does not count synthetic API-error messages as served models", () => {
    const summary = summarizeClaudeTrace([
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { model: "claude-opus-5-5", content: [] },
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { model: "<synthetic>", content: [{ type: "text", text: "API Error: 429" }] },
      },
    ]);

    expect(summary.servedModels).toEqual(["claude-opus-5-5"]);
  });

  test("records the served model of assistant events that omit parent_tool_use_id", () => {
    const summary = summarizeClaudeTrace([
      { type: "assistant", message: { model: "claude-sonnet-5-5", content: [] } },
    ]);

    expect(summary.servedModels).toEqual(["claude-sonnet-5-5"]);
  });

  test("ignores malformed events", () => {
    const summary = summarizeClaudeTrace([null, "text", { type: "assistant" }, { type: "user" }]);

    expect(summary).toMatchObject({ commands: [], toolCalls: 0, servedModels: [] });
  });
});

describe("served model check", () => {
  test("accepts the requested id and its dated snapshots", () => {
    expect(
      findServedModelMismatches("claude-haiku-4-5", [
        "claude-haiku-4-5-20251001",
        "claude-haiku-4-5",
      ]),
    ).toEqual([]);
  });

  test("reports models that differ from the requested id", () => {
    expect(
      findServedModelMismatches("claude-opus-5-5", ["claude-opus-5-5", "claude-sonnet-5-5"]),
    ).toEqual(["claude-sonnet-5-5"]);
    expect(findServedModelMismatches("claude-opus-5", ["claude-opus-5-5"])).toEqual([
      "claude-opus-5-5",
    ]);
  });

  test("accepts the base id when a context-window suffix is requested", () => {
    expect(findServedModelMismatches("claude-opus-5-5[1m]", ["claude-opus-5-5"])).toEqual([]);
    expect(findServedModelMismatches("claude-opus-5-5[1m]", ["claude-sonnet-5-5"])).toEqual([
      "claude-sonnet-5-5",
    ]);
  });

  test("skips the check for aliases", () => {
    expect(findServedModelMismatches("opus", ["claude-opus-5-5"])).toEqual([]);
  });
});

describe("same model check", () => {
  test("treats context-window suffixes and dated snapshots as the same model", () => {
    expect(isSameClaudeModel("claude-opus-5-5[1m]", "claude-opus-5-5")).toBe(true);
    expect(isSameClaudeModel("claude-opus-5-5", "claude-opus-5-5-20260901")).toBe(true);
    expect(isSameClaudeModel("claude-opus-5", "claude-opus-5-5")).toBe(false);
    expect(isSameClaudeModel("claude-fable-5-1", "claude-opus-5-5")).toBe(false);
  });
});
