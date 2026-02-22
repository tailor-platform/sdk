import { describe, expect, it } from "vitest";
import {
  formatSolveModelLabel,
  normalizeModelForAgent,
  parseSolveModelLabel,
  resolveRerunSolveConfig,
} from "./solve-model";

describe("normalizeModelForAgent", () => {
  it("normalizes codex default model to undefined", () => {
    expect(normalizeModelForAgent("codex", "default")).toBeUndefined();
  });
});

describe("formatSolveModelLabel", () => {
  it("formats model label with agent", () => {
    expect(formatSolveModelLabel("codex", "o3")).toBe("codex:o3");
  });
});

describe("parseSolveModelLabel", () => {
  it("parses backward-compatible labels without agent", () => {
    expect(parseSolveModelLabel("sonnet")).toEqual({
      agent: "claude",
      model: "sonnet",
    });
  });
});

describe("resolveRerunSolveConfig", () => {
  it("reuses the report model when only agent is explicit", () => {
    expect(
      resolveRerunSolveConfig({
        reportModelRaw: "codex:o3",
        agent: "codex",
        model: undefined,
        agentExplicit: true,
        modelExplicit: false,
      }),
    ).toEqual({
      agent: "codex",
      model: "o3",
    });
  });

  it("prefers explicit model over report model", () => {
    expect(
      resolveRerunSolveConfig({
        reportModelRaw: "codex:o3",
        agent: "codex",
        model: "o4-mini",
        agentExplicit: true,
        modelExplicit: true,
      }),
    ).toEqual({
      agent: "codex",
      model: "o4-mini",
    });
  });

  it("resets model when explicit agent differs from report agent", () => {
    expect(
      resolveRerunSolveConfig({
        reportModelRaw: "claude:sonnet",
        agent: "codex",
        model: undefined,
        agentExplicit: true,
        modelExplicit: false,
      }),
    ).toEqual({
      agent: "codex",
      model: undefined,
    });
  });

  it("uses Claude default model when switching from another agent", () => {
    expect(
      resolveRerunSolveConfig({
        reportModelRaw: "codex:default",
        agent: "claude",
        model: undefined,
        agentExplicit: true,
        modelExplicit: false,
      }),
    ).toEqual({
      agent: "claude",
      model: "sonnet",
    });
  });
});
