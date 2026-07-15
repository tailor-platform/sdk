import { describe, expect, test } from "vitest";
import { selectE2EWorkspaces } from "./select-e2e-workspaces";

describe("selectE2EWorkspaces", () => {
  test("selects only the exact SDK run namespace when a prefix is supplied", () => {
    const runId = "test-run-12345";
    const workspaces = [
      { name: `e2e-ws-${runId}-expected` },
      { name: `e2e-ws-${runId}0-overlap` },
      { name: `template-e2e-${runId}-overlap` },
      { name: `sdk-ci-${runId}-overlap` },
      { name: "e2e-ws-other-run-12345" },
    ];

    expect(selectE2EWorkspaces(workspaces, runId, `e2e-ws-${runId}-`)).toEqual([
      { name: `e2e-ws-${runId}-expected` },
    ]);
  });

  test("rejects a prefix that does not exactly match the SDK run namespace", () => {
    expect(() => selectE2EWorkspaces([], "test-run-12345", "e2e-ws-test-run-")).toThrow(
      "Exact workspace prefix",
    );
  });

  test("rejects an empty run ID instead of broadening the selection", () => {
    expect(() => selectE2EWorkspaces([{ name: "e2e-ws-anything" }], "")).toThrow(
      "Run ID must not be empty",
    );
  });

  test("preserves the existing broad run match when no exact prefix is supplied", () => {
    expect(
      selectE2EWorkspaces(
        [
          { name: "e2e-ws-123-sdk" },
          { name: "template-e2e-123-template" },
          { name: "personal-123" },
        ],
        "123",
      ),
    ).toEqual([{ name: "e2e-ws-123-sdk" }, { name: "template-e2e-123-template" }]);
  });
});
