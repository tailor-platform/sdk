import * as os from "node:os";
import { describe, test, expect } from "vitest";
import { sanitizeArgv, sanitizeMessage, sanitizeStackTrace } from "./sanitize";

describe("sanitizeStackTrace", () => {
  test.each([
    {
      name: "replaces SDK absolute paths with relative paths",
      stack:
        "Error: boom\n    at Object.<anonymous> (/home/user/projects/packages/sdk/src/cli/index.ts:10:5)",
      contains: ["packages/sdk/src/cli/index.ts:10:5"],
      excludes: ["/home/user/projects/"],
    },
    {
      name: "replaces external absolute paths with <external>/filename",
      stack: "Error: boom\n    at Object.<anonymous> (/usr/lib/node_modules/some-lib/index.js:1:1)",
      contains: ["<external>/index.js"],
      excludes: ["/usr/lib/"],
    },
    {
      name: "redacts sensitive data in the error message line of a stack trace",
      stack:
        "Error: token abc123def456789012345678901234567890 for user@example.com\n    at Object.<anonymous> (/home/user/projects/packages/sdk/src/cli/index.ts:10:5)",
      contains: ["<redacted>", "<email>"],
      excludes: ["abc123def456789012345678901234567890", "user@example.com"],
    },
    {
      name: "redacts sensitive data in multiline error messages before stack frames",
      stack: [
        "Error: Failed to connect",
        'Request: {"token":"s3cret","email":"admin@corp.com"}',
        "    at Object.<anonymous> (/home/user/projects/packages/sdk/src/cli/index.ts:10:5)",
      ].join("\n"),
      contains: [],
      excludes: ["s3cret", "admin@corp.com"],
    },
    {
      name: "replaces Windows-style absolute paths with <external>/filename",
      stack:
        "Error: boom\n    at Object.<anonymous> (C:\\Users\\admin\\projects\\some-lib\\index.js:1:1)",
      contains: ["<external>/index.js"],
      excludes: ["C:\\Users\\admin"],
    },
    {
      name: "replaces Windows SDK paths with relative paths",
      stack:
        "Error: boom\n    at Object.<anonymous> (D:\\work\\packages\\sdk\\src\\cli\\index.ts:10:5)",
      contains: ["packages/sdk/src/cli/index.ts:10:5"],
      excludes: ["D:\\work\\"],
    },
  ])("$name", ({ stack, contains, excludes }) => {
    const result = sanitizeStackTrace(stack);
    for (const value of contains) expect(result).toContain(value);
    for (const value of excludes) expect(result).not.toContain(value);
  });

  test("replaces home directory paths with ~/<redacted>/", () => {
    const homeDir = os.homedir();
    const stack = `Error: boom\n    at Object.<anonymous> (${homeDir}/some-project/file.ts:5:3)`;
    const result = sanitizeStackTrace(stack);
    expect(result).toContain("~/<redacted>/file.ts");
    expect(result).not.toContain(homeDir);
  });

  test("preserves non-path content", () => {
    const stack = "TypeError: Cannot read properties of undefined";
    const result = sanitizeStackTrace(stack);
    expect(result).toBe("TypeError: Cannot read properties of undefined");
  });
});

describe("sanitizeMessage", () => {
  test.each([
    {
      name: "redacts UUIDs",
      message: "Workspace 550e8400-e29b-41d4-a716-446655440000 not found",
      contains: ["<uuid>"],
      excludes: ["550e8400"],
    },
    {
      name: "redacts long hex strings (tokens)",
      message: "Token abc123def456789012345678901234567890 is invalid",
      contains: ["<redacted>"],
      excludes: ["abc123def456789012345678901234567890"],
    },
    {
      name: "redacts email addresses",
      message: "User user@example.com not found",
      contains: ["<email>"],
      excludes: ["user@example.com"],
    },
    {
      name: "redacts URL query strings",
      message: "Failed to fetch https://api.example.com/v1/data?token=secret&id=123",
      contains: ["?<redacted>"],
      excludes: ["token=secret"],
    },
    {
      name: "redacts absolute paths keeping basename",
      message: "File not found: /home/user/projects/my-app/config.yaml",
      contains: ["<path>/config.yaml"],
      excludes: ["/home/user/"],
    },
    {
      name: "strips serialized request bodies from error messages",
      message:
        'Failed to apply config\nRequest: {"secretmanagerSecretValue":"s3cret","name":"test"}',
      contains: ["Failed to apply config", "Request: <redacted>"],
      excludes: ["s3cret"],
    },
    {
      name: "redacts Windows-style absolute paths keeping basename",
      message: "File not found: C:\\Users\\admin\\project\\tailor.config.ts",
      contains: ["<path>/tailor.config.ts"],
      excludes: ["C:\\Users\\admin"],
    },
  ])("$name", ({ message, contains, excludes }) => {
    const result = sanitizeMessage(message);
    for (const value of contains) expect(result).toContain(value);
    for (const value of excludes) expect(result).not.toContain(value);
  });

  test("preserves simple messages", () => {
    const message = "Something went wrong";
    expect(sanitizeMessage(message)).toBe("Something went wrong");
  });
});

describe("sanitizeArgv", () => {
  test("keeps command and subcommand names", () => {
    const argv = ["node", "tailor", "apply"];
    expect(sanitizeArgv(argv)).toEqual(["node", "tailor", "apply"]);
  });

  test.each([
    {
      name: "redacts value after any long flag (space format)",
      argv: ["node", "tailor", "show", "--workspace-id", "some-uuid"],
      expected: ["node", "tailor", "show", "--workspace-id", "<redacted>"],
    },
    {
      name: "redacts value after any short flag (space format)",
      argv: ["node", "tailor", "show", "-w", "some-uuid"],
      expected: ["node", "tailor", "show", "-w", "<redacted>"],
    },
    {
      name: "redacts value after any flag regardless of flag name",
      argv: ["node", "tailor", "apply", "--region", "asia-northeast"],
      expected: ["node", "tailor", "apply", "--region", "<redacted>"],
    },
    {
      name: "treats consecutive flags correctly (no value between them)",
      argv: ["node", "tailor", "apply", "--verbose", "--yes"],
      expected: ["node", "tailor", "apply", "--verbose", "--yes"],
    },
    {
      name: "redacts value after boolean flag followed by valued flag",
      argv: ["node", "tailor", "apply", "--verbose", "--workspace-id", "secret"],
      expected: ["node", "tailor", "apply", "--verbose", "--workspace-id", "<redacted>"],
    },
  ])("$name", ({ argv, expected }) => {
    expect(sanitizeArgv(argv)).toEqual(expected);
  });

  test("redacts --flag=value (equals format)", () => {
    const argv = ["node", "tailor", "show", "--workspace-id=some-uuid"];
    const result = sanitizeArgv(argv);
    expect(result).toContain("--workspace-id=<redacted>");
    expect(result).not.toContain("some-uuid");
  });

  test.each([
    {
      name: "redacts absolute path positional arguments",
      argv: ["node", "tailor", "/home/user/project/tailor.config.ts"],
      contains: "<path>",
      excludes: "/home/user/",
    },
    {
      name: "redacts Windows-style absolute path positional arguments",
      argv: ["node", "tailor", "C:\\Users\\admin\\project\\tailor.config.ts"],
      contains: "<path>",
      excludes: "C:\\Users\\admin",
    },
    {
      name: "redacts email address positional arguments",
      argv: ["node", "tailor", "user", "switch", "user@example.com"],
      contains: "<email>",
      excludes: "user@example.com",
    },
  ])("$name", ({ argv, contains, excludes }) => {
    const result = sanitizeArgv(argv);
    expect(result).toContain(contains);
    expect(result).not.toContain(excludes);
  });
});
