import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import { CLIError, errorToJson } from "./errors";
import { CIPromptError } from "./logger";

describe("errorToJson", () => {
  test("preserves machine-actionable CLI error fields", () => {
    const error = CLIError({
      code: "WORKSPACE_NOT_FOUND",
      message: "No workspaces are available.",
      suggestion: "Create a workspace.",
      command: "deploy",
      next: {
        command: "tailor-sdk",
        args: ["deploy", "--create-workspace", "--workspace-name", "example"],
      },
      context: { availableRegions: ["us-west"] },
    });

    expect(errorToJson(error)).toEqual({
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: "No workspaces are available.",
        suggestion: "Create a workspace.",
        help: { command: "tailor-sdk", args: ["deploy", "--help"] },
        next: {
          command: "tailor-sdk",
          args: ["deploy", "--create-workspace", "--workspace-name", "example"],
        },
        context: { availableRegions: ["us-west"] },
      },
    });
  });

  test("normalizes unexpected errors", () => {
    expect(errorToJson(new Error("broken"))).toEqual({
      error: { code: "UNEXPECTED_ERROR", message: "broken" },
    });
    expect(errorToJson("broken")).toEqual({
      error: { code: "UNKNOWN_ERROR", message: "broken" },
    });
  });

  test("gives non-interactive prompt failures a stable code", () => {
    expect(errorToJson(new CIPromptError())).toEqual({
      error: {
        code: "INTERACTIVE_PROMPT_REQUIRED",
        message: expect.stringContaining("required options explicitly"),
      },
    });
  });

  test("preserves Connect RPC error codes for automation", () => {
    expect(errorToJson(new ConnectError("permission denied", Code.PermissionDenied))).toEqual({
      error: {
        code: "RPC_PERMISSION_DENIED",
        message: expect.stringContaining("permission denied"),
      },
    });
  });

  test("uses Windows-compatible quoting for human next commands on Windows", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const error = CLIError({
      message: "Choose a workspace.",
      next: {
        command: "tailor-sdk",
        args: [
          "deploy",
          "--config",
          "C:\\Users\\Jane Doe\\tailor.config.ts",
          "--workspace-id",
          "<workspace-id>",
        ],
      },
    });

    expect(error.format()).toContain(
      'tailor-sdk deploy --config "C:\\Users\\Jane Doe\\tailor.config.ts" --workspace-id "<workspace-id>"',
    );
  });

  test("includes a stack trace only when requested", () => {
    const error = new Error("broken");

    expect(errorToJson(error, { includeStack: true }).error.stack).toBe(error.stack);
    expect(errorToJson(error).error).not.toHaveProperty("stack");
  });
});
