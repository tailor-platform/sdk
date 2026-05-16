import { describe, expect, it } from "vitest";
import { formatSolveModelLabel, normalizeModel, parseSolveModelLabel } from "./solve-model";

describe("normalizeModel", () => {
  it("defaults undefined / 'default' to qwen2.5-coder:7b", () => {
    expect(normalizeModel(undefined)).toBe("qwen2.5-coder:7b");
    expect(normalizeModel("default")).toBe("qwen2.5-coder:7b");
  });

  it("passes a concrete model id through unchanged", () => {
    expect(normalizeModel("gpt-oss:20b")).toBe("gpt-oss:20b");
  });
});

describe("formatSolveModelLabel", () => {
  it("formats with the supplied model id", () => {
    expect(formatSolveModelLabel("gpt-oss:20b")).toBe("oss:gpt-oss:20b");
  });

  it("falls back to qwen2.5-coder:7b when model is undefined", () => {
    expect(formatSolveModelLabel(undefined)).toBe("oss:qwen2.5-coder:7b");
  });
});

describe("parseSolveModelLabel", () => {
  it("returns the default model when label is undefined", () => {
    expect(parseSolveModelLabel(undefined)).toEqual({ model: "qwen2.5-coder:7b" });
  });

  it("strips the oss: prefix and preserves colons inside the model id", () => {
    // The Ollama model id contains a `:`; the parser must keep it intact so
    // analyze --groups can recover the full label from a results filename.
    expect(parseSolveModelLabel("oss:gpt-oss:20b")).toEqual({ model: "gpt-oss:20b" });
  });

  it("treats a bare label without the oss: prefix as the model id verbatim", () => {
    expect(parseSolveModelLabel("qwen2.5-coder:7b")).toEqual({ model: "qwen2.5-coder:7b" });
  });
});
