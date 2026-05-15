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
  it("returns the default model when label is undefined", () => {
    expect(parseSolveModelLabel(undefined)).toEqual({ model: "gpt-oss:20b" });
  });

  it("strips the oss: prefix and preserves colons inside the model id", () => {
    // The Ollama model id contains a `:`; the parser must keep it intact so
    // analyze --groups can recover the full label from a results filename.
    expect(parseSolveModelLabel("oss:gpt-oss:20b")).toEqual({ model: "gpt-oss:20b" });
  });

  it("treats a bare label without the oss: prefix as the model id verbatim", () => {
    expect(parseSolveModelLabel("gpt-oss:20b")).toEqual({ model: "gpt-oss:20b" });
  });
});
