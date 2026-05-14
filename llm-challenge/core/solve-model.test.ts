import { describe, expect, it } from "vitest";
import { formatSolveModelLabel, normalizeModelForAgent, parseSolveModelLabel } from "./solve-model";

describe("normalizeModelForAgent", () => {
  it("normalizes codex default model to undefined", () => {
    expect(normalizeModelForAgent("codex", "default")).toBeUndefined();
  });

  it("normalizes oss default to gpt-oss:20b", () => {
    expect(normalizeModelForAgent("oss", undefined)).toBe("gpt-oss:20b");
    expect(normalizeModelForAgent("oss", "default")).toBe("gpt-oss:20b");
  });
});

describe("formatSolveModelLabel", () => {
  it("formats model label with agent", () => {
    expect(formatSolveModelLabel("codex", "o3")).toBe("codex:o3");
  });

  it("falls back to sonnet when claude model is undefined", () => {
    expect(formatSolveModelLabel("claude", undefined)).toBe("claude:sonnet");
  });

  it("falls back to default when codex model is undefined", () => {
    expect(formatSolveModelLabel("codex", undefined)).toBe("codex:default");
  });

  it("falls back to gpt-oss:20b when oss model is undefined", () => {
    expect(formatSolveModelLabel("oss", undefined)).toBe("oss:gpt-oss:20b");
  });
});

describe("parseSolveModelLabel", () => {
  it("parses backward-compatible labels without agent", () => {
    expect(parseSolveModelLabel("sonnet")).toEqual({
      agent: "claude",
      model: "sonnet",
    });
  });

  it("returns claude:sonnet defaults when label is undefined", () => {
    expect(parseSolveModelLabel(undefined)).toEqual({
      agent: "claude",
      model: "sonnet",
    });
  });

  it("parses codex:o3 into agent and model", () => {
    expect(parseSolveModelLabel("codex:o3")).toEqual({
      agent: "codex",
      model: "o3",
    });
  });

  it("parses oss:gpt-oss:20b without losing the colon in the model id", () => {
    // The Ollama model id contains a `:`; rest.join(":") must survive it so
    // analyze --groups can recover the full label from a results filename.
    expect(parseSolveModelLabel("oss:gpt-oss:20b")).toEqual({
      agent: "oss",
      model: "gpt-oss:20b",
    });
  });
});
