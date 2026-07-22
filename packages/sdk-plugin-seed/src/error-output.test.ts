import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import { serializeError } from "./error-output";

describe("serializeError", () => {
  test("preserves machine-actionable CLI error fields", () => {
    const error = Object.assign(new Error("Choose a workspace."), {
      name: "CLIError",
      code: "WORKSPACE_NOT_FOUND",
      suggestion: "Create a workspace.",
      next: {
        command: "tailor-sdk",
        args: ["deploy", "--create-workspace"],
      },
      context: { availableRegions: ["us-west"] },
      format: () => "Choose a workspace.",
    });

    expect(JSON.parse(serializeError(error, false))).toEqual({
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: "Choose a workspace.",
        suggestion: "Create a workspace.",
        next: {
          command: "tailor-sdk",
          args: ["deploy", "--create-workspace"],
        },
        context: { availableRegions: ["us-west"] },
      },
    });
  });

  test("preserves Connect RPC error codes", () => {
    expect(
      JSON.parse(
        serializeError(new ConnectError("permission denied", Code.PermissionDenied), false),
      ),
    ).toEqual({
      error: {
        code: "RPC_PERMISSION_DENIED",
        message: expect.stringContaining("permission denied"),
      },
    });
  });
});
