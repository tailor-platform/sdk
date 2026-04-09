import * as os from "node:os";
import { describe, test, expect } from "vitest";
import { sanitizeArgv, sanitizeMessage, sanitizeStackTrace } from "./sanitize";

describe("sanitizeStackTrace", () => {
  test("replaces SDK absolute paths with relative paths", () => {
    const stack =
      "Error: boom\n    at Object.<anonymous> (/home/user/projects/packages/sdk/src/cli/index.ts:10:5)";
    const result = sanitizeStackTrace(stack);
    expect(result).toContain("packages/sdk/src/cli/index.ts:10:5");
    expect(result).not.toContain("/home/user/projects/");
  });

  test("replaces home directory paths with ~/<redacted>/", () => {
    const homeDir = os.homedir();
    const stack = `Error: boom\n    at Object.<anonymous> (${homeDir}/some-project/file.ts:5:3)`;
    const result = sanitizeStackTrace(stack);
    expect(result).toContain("~/<redacted>/file.ts");
    expect(result).not.toContain(homeDir);
  });

  test("replaces external absolute paths with <external>/filename", () => {
    const stack =
      "Error: boom\n    at Object.<anonymous> (/usr/lib/node_modules/some-lib/index.js:1:1)";
    const result = sanitizeStackTrace(stack);
    expect(result).toContain("<external>/index.js");
    expect(result).not.toContain("/usr/lib/");
  });

  test("preserves non-path content", () => {
    const stack = "TypeError: Cannot read properties of undefined";
    const result = sanitizeStackTrace(stack);
    expect(result).toBe("TypeError: Cannot read properties of undefined");
  });

  test("redacts sensitive data in the error message line of a stack trace", () => {
    const stack =
      "Error: token abc123def456789012345678901234567890 for user@example.com\n    at Object.<anonymous> (/home/user/projects/packages/sdk/src/cli/index.ts:10:5)";
    const result = sanitizeStackTrace(stack);
    expect(result).not.toContain("abc123def456789012345678901234567890");
    expect(result).not.toContain("user@example.com");
    expect(result).toContain("<redacted>");
    expect(result).toContain("<email>");
  });

  test("redacts sensitive data in multiline error messages before stack frames", () => {
    const stack = [
      "Error: Failed to connect",
      'Request: {"token":"s3cret","email":"admin@corp.com"}',
      "    at Object.<anonymous> (/home/user/projects/packages/sdk/src/cli/index.ts:10:5)",
    ].join("\n");
    const result = sanitizeStackTrace(stack);
    expect(result).not.toContain("s3cret");
    expect(result).not.toContain("admin@corp.com");
  });

  test("replaces Windows-style absolute paths with <external>/filename", () => {
    const stack =
      "Error: boom\n    at Object.<anonymous> (C:\\Users\\admin\\projects\\some-lib\\index.js:1:1)";
    const result = sanitizeStackTrace(stack);
    expect(result).toContain("<external>/index.js");
    expect(result).not.toContain("C:\\Users\\admin");
  });

  test("replaces Windows SDK paths with relative paths", () => {
    const stack =
      "Error: boom\n    at Object.<anonymous> (D:\\work\\packages\\sdk\\src\\cli\\index.ts:10:5)";
    const result = sanitizeStackTrace(stack);
    expect(result).toContain("packages/sdk/src/cli/index.ts:10:5");
    expect(result).not.toContain("D:\\work\\");
  });
});

describe("sanitizeMessage", () => {
  test("redacts UUIDs", () => {
    const message = "Workspace 550e8400-e29b-41d4-a716-446655440000 not found";
    const result = sanitizeMessage(message);
    expect(result).toContain("<uuid>");
    expect(result).not.toContain("550e8400");
  });

  test("redacts long hex strings (tokens)", () => {
    const message = "Token abc123def456789012345678901234567890 is invalid";
    const result = sanitizeMessage(message);
    expect(result).toContain("<redacted>");
    expect(result).not.toContain("abc123def456789012345678901234567890");
  });

  test("redacts email addresses", () => {
    const message = "User user@example.com not found";
    const result = sanitizeMessage(message);
    expect(result).toContain("<email>");
    expect(result).not.toContain("user@example.com");
  });

  test("redacts URL query strings", () => {
    const message = "Failed to fetch https://api.example.com/v1/data?token=secret&id=123";
    const result = sanitizeMessage(message);
    expect(result).toContain("?<redacted>");
    expect(result).not.toContain("token=secret");
  });

  test("redacts absolute paths keeping basename", () => {
    const message = "File not found: /home/user/projects/my-app/config.yaml";
    const result = sanitizeMessage(message);
    expect(result).toContain("<path>/config.yaml");
    expect(result).not.toContain("/home/user/");
  });

  test("preserves simple messages", () => {
    const message = "Something went wrong";
    expect(sanitizeMessage(message)).toBe("Something went wrong");
  });

  test("strips serialized request bodies from error messages", () => {
    const message =
      'Failed to apply config\nRequest: {"secretmanagerSecretValue":"s3cret","name":"test"}';
    const result = sanitizeMessage(message);
    expect(result).toContain("Failed to apply config");
    expect(result).not.toContain("s3cret");
    expect(result).toContain("Request: <redacted>");
  });

  test("redacts Windows-style absolute paths keeping basename", () => {
    const message = "File not found: C:\\Users\\admin\\project\\tailor.config.ts";
    const result = sanitizeMessage(message);
    expect(result).toContain("<path>/tailor.config.ts");
    expect(result).not.toContain("C:\\Users\\admin");
  });
});

describe("sanitizeArgv", () => {
  test("keeps command and subcommand names", () => {
    const argv = ["node", "tailor-sdk", "apply"];
    const result = sanitizeArgv(argv);
    expect(result).toEqual(["node", "tailor-sdk", "apply"]);
  });

  test("redacts value after any long flag (space format)", () => {
    const argv = ["node", "tailor-sdk", "show", "--workspace-id", "some-uuid"];
    const result = sanitizeArgv(argv);
    expect(result).toEqual(["node", "tailor-sdk", "show", "--workspace-id", "<redacted>"]);
  });

  test("redacts value after any short flag (space format)", () => {
    const argv = ["node", "tailor-sdk", "show", "-w", "some-uuid"];
    const result = sanitizeArgv(argv);
    expect(result).toEqual(["node", "tailor-sdk", "show", "-w", "<redacted>"]);
  });

  test("redacts --flag=value (equals format)", () => {
    const argv = ["node", "tailor-sdk", "show", "--workspace-id=some-uuid"];
    const result = sanitizeArgv(argv);
    expect(result).toContain("--workspace-id=<redacted>");
    expect(result).not.toContain("some-uuid");
  });

  test("redacts value after any flag regardless of flag name", () => {
    const argv = ["node", "tailor-sdk", "apply", "--region", "asia-northeast"];
    const result = sanitizeArgv(argv);
    expect(result).toEqual(["node", "tailor-sdk", "apply", "--region", "<redacted>"]);
  });

  test("treats consecutive flags correctly (no value between them)", () => {
    const argv = ["node", "tailor-sdk", "apply", "--verbose", "--yes"];
    const result = sanitizeArgv(argv);
    expect(result).toEqual(["node", "tailor-sdk", "apply", "--verbose", "--yes"]);
  });

  test("redacts value after boolean flag followed by valued flag", () => {
    const argv = ["node", "tailor-sdk", "apply", "--verbose", "--workspace-id", "secret"];
    const result = sanitizeArgv(argv);
    expect(result).toEqual([
      "node",
      "tailor-sdk",
      "apply",
      "--verbose",
      "--workspace-id",
      "<redacted>",
    ]);
  });

  test("redacts absolute path positional arguments", () => {
    const argv = ["node", "tailor-sdk", "/home/user/project/tailor.config.ts"];
    const result = sanitizeArgv(argv);
    expect(result).toContain("<path>");
    expect(result).not.toContain("/home/user/");
  });

  test("redacts Windows-style absolute path positional arguments", () => {
    const argv = ["node", "tailor-sdk", "C:\\Users\\admin\\project\\tailor.config.ts"];
    const result = sanitizeArgv(argv);
    expect(result).toContain("<path>");
    expect(result).not.toContain("C:\\Users\\admin");
  });

  test("redacts email address positional arguments", () => {
    const argv = ["node", "tailor-sdk", "user", "switch", "user@example.com"];
    const result = sanitizeArgv(argv);
    expect(result).toContain("<email>");
    expect(result).not.toContain("user@example.com");
  });
});
