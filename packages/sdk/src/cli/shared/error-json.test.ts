import { describe, test, expect } from "vitest";
import { withErrorDiagnostics } from "./error-diagnostics";
import { errorToJson } from "./error-json";

describe("errorToJson", () => {
  test("keeps a source location out of the JSON envelope", () => {
    const error = withErrorDiagnostics(new Error("boom"), {
      code: "SEED_INVALID",
      location: { file: "/abs/data.jsonl", line: 4 },
    });
    const { error: envelope } = errorToJson(error);
    expect(envelope.code).toBe("SEED_INVALID");
    expect(envelope).not.toHaveProperty("location");
    expect(JSON.stringify(envelope)).not.toContain("/abs/data.jsonl");
  });

  test("still carries the diagnostics that belong in the envelope", () => {
    const error = withErrorDiagnostics(new Error("boom"), {
      code: "X",
      suggestion: "do y",
      context: { namespace: "n" },
    });
    const { error: envelope } = errorToJson(error);
    expect(envelope.suggestion).toBe("do y");
    expect(envelope.context).toEqual({ namespace: "n" });
  });
});
