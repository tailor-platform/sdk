import { describe, expect, it } from "vitest";
import { formatSolveModelLabel, normalizeModelForAgent, parseSolveModelLabel } from "./solve-model";

describe("normalizeModelForAgent", () => {
  it("normalizes codex default model to undefined", () => {
    expect(normalizeModelForAgent("codex", "default")).toBeUndefined();
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
});
