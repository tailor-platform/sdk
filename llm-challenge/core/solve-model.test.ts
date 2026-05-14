import { describe, expect, it } from "vitest";
import { formatSolveModelLabel, normalizeModel, parseSolveModelLabel } from "./solve-model";

describe("normalizeModel", () => {
  it("defaults undefined / 'default' to gpt-oss:20b", () => {
    expect(normalizeModel(undefined)).toBe("gpt-oss:20b");
    expect(normalizeModel("default")).toBe("gpt-oss:20b");
  });

  it("passes a concrete model id through unchanged", () => {
    expect(normalizeModel("qwen3-coder:30b")).toBe("qwen3-coder:30b");
  });
});

describe("formatSolveModelLabel", () => {
  it("formats with the supplied model id", () => {
    expect(formatSolveModelLabel("qwen3-coder:30b")).toBe("oss:qwen3-coder:30b");
  });

  it("falls back to gpt-oss:20b when model is undefined", () => {
    expect(formatSolveModelLabel(undefined)).toBe("oss:gpt-oss:20b");
  });
});

describe("parseSolveModelLabel", () => {
  it("returns oss:gpt-oss:20b defaults when label is undefined", () => {
    expect(parseSolveModelLabel(undefined)).toEqual({
      agent: "oss",
      model: "gpt-oss:20b",
    });
  });

  it("parses legacy claude:sonnet labels for analyze backwards-compat", () => {
    expect(parseSolveModelLabel("claude:sonnet")).toEqual({
      agent: "claude",
      model: "sonnet",
    });
  });

  it("parses legacy codex:o3 labels", () => {
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

  it("treats a bare legacy label without colon as the old claude default", () => {
    expect(parseSolveModelLabel("sonnet")).toEqual({
      agent: "claude",
      model: "sonnet",
    });
  });
});
