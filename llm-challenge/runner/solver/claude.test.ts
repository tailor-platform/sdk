import { describe, expect, it } from "vitest";
import { interpretClaudeAuthStatus } from "./claude";

describe("interpretClaudeAuthStatus", () => {
  it("treats parsed non-error JSON as success even if exit code is non-zero", () => {
    const result = interpretClaudeAuthStatus({
      code: 1,
      stdout: JSON.stringify({
        result: "ok",
        is_error: false,
        total_cost_usd: 0,
        duration_ms: 10,
      }),
      stderr: "non-fatal warning",
    });

    expect(result).toEqual({
      ok: true,
    });
  });

  it("fails when Claude JSON output reports is_error even if exit code is zero", () => {
    const result = interpretClaudeAuthStatus({
      code: 0,
      stdout: JSON.stringify({
        result: "authentication failed",
        is_error: true,
        total_cost_usd: 0,
        duration_ms: 10,
      }),
      stderr: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "authentication failed",
    });
  });
});
