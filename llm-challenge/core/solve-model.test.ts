import { describe, expect, it } from "vitest";
import { formatSolveModelLabel, parseSolveModelLabel } from "./solve-model";

describe("formatSolveModelLabel", () => {
  it("formats the codex model + effort into a directory-safe label", () => {
    expect(formatSolveModelLabel("xhigh")).toBe("codex-gpt-5.5-xhigh");
    expect(formatSolveModelLabel("medium")).toBe("codex-gpt-5.5-medium");
  });
});

describe("parseSolveModelLabel", () => {
  it("returns the empty model for an undefined label", () => {
    expect(parseSolveModelLabel(undefined)).toEqual({ model: "" });
  });

  it("parses the current scheme back into model + effort", () => {
    expect(parseSolveModelLabel("codex-gpt-5.5-xhigh")).toEqual({
      model: "codex-gpt-5.5-xhigh",
      effort: "xhigh",
    });
  });

  it("passes through legacy labels verbatim so old reports still group", () => {
    // Pre-codex reports used `oss:<model>`; analyse.ts groups by the raw
    // label, so we just need to surface it as `model` without crashing.
    expect(parseSolveModelLabel("oss:qwen3:8b")).toEqual({ model: "oss:qwen3:8b" });
    expect(parseSolveModelLabel("qwen3:8b")).toEqual({ model: "qwen3:8b" });
  });
});
