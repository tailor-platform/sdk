import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { errorToJson, serializeError } from "./error-json";
import {
  CLIError,
  errorSummary,
  formatCommandHint,
  internalError,
  isCLIError,
  toError,
  typeOnlyImportHint,
} from "./errors";
import { CIPromptError } from "./logger";
import type { Jsonifiable } from "type-fest";

describe("typeOnlyImportHint", () => {
  test("suggests import type for a missing named export", () => {
    const error = new SyntaxError(
      "The requested module './types.ts' does not provide an export named 'Row'",
    );

    const hint = typeOnlyImportHint(error);

    expect(hint).toContain("import type");
    expect(hint).toContain("'Row'");
    expect(hint).toContain("verbatimModuleSyntax");
  });

  test("ignores a missing default export", () => {
    const error = new SyntaxError(
      "The requested module './config.ts' does not provide an export named 'default'",
    );

    expect(typeOnlyImportHint(error)).toBeUndefined();
  });

  test("suggests for a name that merely starts with 'default'", () => {
    const error = new SyntaxError(
      "The requested module './types.ts' does not provide an export named 'defaultRow'",
    );

    expect(typeOnlyImportHint(error)).toContain("'defaultRow'");
  });

  test("ignores unrelated syntax errors", () => {
    expect(typeOnlyImportHint(new SyntaxError("Unexpected token '}'"))).toBeUndefined();
  });

  test("ignores non-syntax errors with a matching message", () => {
    const error = new Error(
      "The requested module './types.ts' does not provide an export named 'Row'",
    );

    expect(typeOnlyImportHint(error)).toBeUndefined();
  });
});

describe("errorToJson", () => {
  test("keeps diagnostic types JSON-compatible", () => {
    expectTypeOf<CLIError["context"]>().toExtend<Jsonifiable | undefined>();
    expectTypeOf<ReturnType<typeof errorToJson>>().toExtend<Jsonifiable>();
  });

  test("preserves machine-actionable CLI error fields", () => {
    const error = CLIError({
      code: "WORKSPACE_NOT_FOUND",
      message: "No workspaces are available.",
      suggestion: "Create a workspace.",
      command: "deploy",
      next: {
        command: "tailor",
        args: ["deploy", "--create-workspace", "--workspace-name", "example"],
      },
      context: { availableRegions: ["us-west"] },
    });

    expect(errorToJson(error)).toEqual({
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: "No workspaces are available.",
        suggestion: "Create a workspace.",
        help: { command: "tailor", args: ["deploy", "--help"] },
        next: {
          command: "tailor",
          args: ["deploy", "--create-workspace", "--workspace-name", "example"],
        },
        context: { availableRegions: ["us-west"] },
      },
    });
  });

  test("serializes a stable fallback when the error context is not JSON-compatible", () => {
    const error = CLIError({
      code: "WORKSPACE_NOT_FOUND",
      message: "No workspaces are available.",
      // @ts-expect-error BigInt cannot be serialized in a CLI error context.
      context: { availableRegions: 1n },
    });

    expect(JSON.parse(serializeError(error, { includeStack: true }))).toEqual({
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: "No workspaces are available.",
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
        suggestion: expect.stringContaining("workspace role and token permissions"),
      },
    });
  });

  test("uses Windows-compatible quoting for human next commands on Windows", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const error = CLIError({
      code: "WORKSPACE_SELECTION_REQUIRED",
      message: "Choose a workspace.",
      next: {
        command: "tailor",
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
      'tailor deploy --config "C:\\Users\\Jane Doe\\tailor.config.ts" --workspace-id "<workspace-id>"',
    );
  });

  test("names a PowerShell and a cmd.exe next command when the Windows shells quote differently", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const error = CLIError({
      code: "WORKSPACE_SELECTION_REQUIRED",
      message: "Choose a workspace.",
      next: {
        command: "tailor",
        args: ["deploy", "--config", "C:\\work\\%APPDATA%\\tailor.config.ts"],
      },
    });

    expect(error.format()).toContain(
      `Run \`tailor deploy --config 'C:\\work\\%APPDATA%\\tailor.config.ts'\` in PowerShell or \`tailor deploy --config "C:\\work\\%%cd:~,%APPDATA%%cd:~,%\\tailor.config.ts"\` in cmd.exe.`,
    );
  });

  const hintRenderers = {
    shell: (commandLine: string) => `shell: ${commandLine}`,
    perShell: (instruction: string) => `perShell: ${instruction}`,
  };

  test("leaves shell-safe command hint values unquoted", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(
      formatCommandHint(
        { command: "tailor", args: ["deploy", "--config=custom.config.ts"] },
        hintRenderers,
      ),
    ).toBe("shell: tailor deploy --config=custom.config.ts");
  });

  test("single-quotes POSIX-unsafe command hint values", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(
      formatCommandHint(
        { command: "tailor", args: ["deploy", "--config=weird $config.ts"] },
        hintRenderers,
      ),
    ).toBe("shell: tailor deploy '--config=weird $config.ts'");
  });

  test("keeps one Windows command line when both shells read the double-quoted arguments alike", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    expect(
      formatCommandHint(
        { command: "tailor", args: ["deploy", "--config", "C:\\work\\!SECRET!\\tailor.config.ts"] },
        hintRenderers,
      ),
    ).toBe('shell: tailor deploy --config "C:\\work\\!SECRET!\\tailor.config.ts"');
  });

  test("hands command hints to the per-shell renderer when the Windows shells quote differently", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    expect(
      formatCommandHint(
        { command: "tailor", args: ["deploy", "--config=%APPDATA%.config.ts"] },
        hintRenderers,
      ),
    ).toBe(
      `perShell: \`tailor deploy '--config=%APPDATA%.config.ts'\` in PowerShell or \`tailor deploy "--config=%%cd:~,%APPDATA%%cd:~,%.config.ts"\` in cmd.exe`,
    );
  });

  test("includes a stack trace only when requested", () => {
    const error = new Error("broken");

    expect(errorToJson(error, { includeStack: true }).error.stack).toBe(error.stack);
    expect(errorToJson(error).error).not.toHaveProperty("stack");
  });

  test("carries the type-only import suggestion for a missing named export", () => {
    const error = new SyntaxError(
      "The requested module './types.ts' does not provide an export named 'Row'",
    );

    expect(errorToJson(error).error.suggestion).toContain("import type");
  });

  test("includes a Connect RPC stack trace when requested", () => {
    const error = new ConnectError("permission denied", Code.PermissionDenied);

    expect(errorToJson(error, { includeStack: true }).error.stack).toBe(error.stack);
    expect(errorToJson(error).error).not.toHaveProperty("stack");
  });

  test("falls back safely for an unknown Connect RPC code", () => {
    expect(errorToJson(new ConnectError("unknown code", 99 as Code))).toEqual({
      error: {
        code: "RPC_CODE_99",
        message: expect.stringContaining("unknown code"),
      },
    });
  });
});

describe("CLIError formatting", () => {
  test("indents every line of a multi-line suggestion", () => {
    const error = CLIError({
      code: "MIGRATION_SCRIPT_SKIP_CONFLICT",
      message: "Conflict.",
      suggestion:
        "Clear the acknowledgment:\n  tailor tailordb migration script 0001\nOr delete migrate.ts.",
    });

    const lines = error.format().split("\n");
    const suggestionLineIndex = lines.findIndex((line) => line.includes("Suggestion:"));
    expect(lines[suggestionLineIndex + 1]).toBe("    tailor tailordb migration script 0001");
    expect(lines[suggestionLineIndex + 2]).toBe("  Or delete migrate.ts.");
  });

  test("indents every line of a multi-line details string", () => {
    const error = CLIError({
      code: "DEPLOY_FAILED",
      message: "Deploy failed.",
      details: "first line\nsecond line",
    });

    const lines = error.format().split("\n");
    const detailsLineIndex = lines.findIndex((line) => line.includes("Details:"));
    expect(lines[detailsLineIndex]).toContain("first line");
    expect(lines[detailsLineIndex + 1]).toMatch(/^\s{2}second line$/);
  });
});

describe("CLIError cause", () => {
  test("keeps the cause on the error object without serializing it", () => {
    const cause = new Error("connection reset");
    const error = CLIError({ code: "VAULT_NOT_FOUND", message: "Vault not found.", cause });

    expect(error.cause).toBe(cause);
    expect(errorToJson(error).error).toEqual({
      code: "VAULT_NOT_FOUND",
      message: "Vault not found.",
    });
  });

  test("leaves cause unset when not provided", () => {
    expect(Object.hasOwn(CLIError({ code: "X", message: "x" }), "cause")).toBe(false);
  });
});

describe("internalError", () => {
  test("is a plain Error reported as UNEXPECTED_ERROR", () => {
    const cause = new Error("root");
    const error = internalError("no manifest generated", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(isCLIError(error)).toBe(false);
    expect(error.name).toBe("Error");
    expect(error.cause).toBe(cause);
    expect(errorToJson(error).error).toEqual({
      code: "UNEXPECTED_ERROR",
      message: "no manifest generated",
    });
  });
});

describe("toError", () => {
  test("returns Error instances unchanged", () => {
    const error = new Error("as-is");
    expect(toError(error)).toBe(error);
  });

  test("wraps non-Error values and keeps them as cause", () => {
    const error = toError({ status: 500 });
    expect(error.message).toBe("[object Object]");
    expect(error.cause).toEqual({ status: 500 });
  });
});

describe("errorSummary", () => {
  test("keeps details and suggestion for CLI errors", () => {
    const error = CLIError({
      code: "MIGRATION_FILE_VERSION_UNSUPPORTED",
      message: "Unsupported version 7.",
      details: "Supported versions 1-6.",
      suggestion: "Upgrade the SDK.",
    });

    expect(errorSummary(error)).toBe(
      "Unsupported version 7.\nSupported versions 1-6.\nUpgrade the SDK.",
    );
  });

  test("falls back to the message or string form", () => {
    expect(errorSummary(new Error("plain"))).toBe("plain");
    expect(errorSummary("text")).toBe("text");
  });
});
