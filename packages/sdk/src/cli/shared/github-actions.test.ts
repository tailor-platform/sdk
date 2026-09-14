import { color } from "@tailor-platform/shared/color";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { CLIError } from "./errors";
import {
  annotateTerminalError,
  annotationsEnabled,
  describeTerminalError,
  formatAnnotation,
} from "./github-actions";

function captureStderr(fn: () => void): string {
  using stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  fn();
  return stderrSpy.mock.calls.map((call) => String(call[0])).join("");
}

describe("github-actions", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GITHUB_ACTIONS;
    delete process.env.TAILOR_GITHUB_ACTIONS_ANNOTATIONS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("annotationsEnabled", () => {
    test("is off outside GitHub Actions", () => {
      expect(annotationsEnabled(false)).toBe(false);
    });

    test("is on when GITHUB_ACTIONS is exactly true", () => {
      process.env.GITHUB_ACTIONS = "true";
      expect(annotationsEnabled(false)).toBe(true);
    });

    test("ignores other truthy spellings of GITHUB_ACTIONS", () => {
      process.env.GITHUB_ACTIONS = "1";
      expect(annotationsEnabled(false)).toBe(false);
    });

    test("is off under JSON mode so the error envelope stays the only document", () => {
      process.env.GITHUB_ACTIONS = "true";
      expect(annotationsEnabled(true)).toBe(false);
    });

    test.each(["false", "off", "0", "no"])("is off when disabled with %s", (value) => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.TAILOR_GITHUB_ACTIONS_ANNOTATIONS = value;
      expect(annotationsEnabled(false)).toBe(false);
    });

    test("stays on for an unrecognized disable value", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.TAILOR_GITHUB_ACTIONS_ANNOTATIONS = "maybe";
      expect(annotationsEnabled(false)).toBe(true);
    });

    test("reads the environment at call time, not at import time", () => {
      expect(annotationsEnabled(false)).toBe(false);
      process.env.GITHUB_ACTIONS = "true";
      expect(annotationsEnabled(false)).toBe(true);
    });
  });

  describe("formatAnnotation", () => {
    test("renders a bare message", () => {
      expect(formatAnnotation("error", "boom")).toBe("::error::boom\n");
    });

    test("percent-encodes % and line breaks in the body", () => {
      expect(formatAnnotation("error", "100% done\r\nnext line")).toBe(
        "::error::100%25 done%0D%0Anext line\n",
      );
    });

    test("escapes : and , in property values on top of the body escapes", () => {
      expect(formatAnnotation("warning", "body", { title: "a:b,c%d" })).toBe(
        "::warning title=a%3Ab%2Cc%25d::body\n",
      );
    });

    test("strips ANSI colors from the body and the title", () => {
      const output = formatAnnotation("error", color.red("red body"), {
        title: color.green("green title"),
      });
      expect(output).toBe("::error title=green title::red body\n");
    });

    test("renders file and line properties in order", () => {
      expect(formatAnnotation("error", "body", { title: "T", file: "src/a.ts", line: 12 })).toBe(
        "::error title=T,file=src/a.ts,line=12::body\n",
      );
    });

    test("emits a notice level", () => {
      expect(formatAnnotation("notice", "hi")).toBe("::notice::hi\n");
    });
  });

  describe("describeTerminalError", () => {
    test("renders a CLIError through its own format() and titles it with the code", () => {
      const error = CLIError({
        message: "config is invalid",
        code: "CONFIG_INVALID",
        details: "auth.idp.name is required",
        suggestion: "Add a name",
      });
      const { message, title } = describeTerminalError(error);
      expect(title).toBe("CONFIG_INVALID");
      expect(message).toBe(error.format());
      expect(message).toContain("auth.idp.name is required");
      expect(message).toContain("Add a name");
    });

    test("falls back to CLI_ERROR when a CLIError carries no code", () => {
      expect(describeTerminalError(CLIError({ message: "boom" })).title).toBe("CLI_ERROR");
    });

    test("uses the error name and appends the caller's suggestion for a plain error", () => {
      const { message, title } = describeTerminalError(new TypeError("bad type"), "try X");
      expect(title).toBe("TypeError");
      expect(message).toBe("bad type\nSuggestion: try X");
    });

    test("omits the suggestion line when there is none", () => {
      expect(describeTerminalError(new Error("plain")).message).toBe("plain");
    });

    test("uses format() for a plain error carrying one, as seed validate throws", () => {
      const error = new Error("seed data is invalid") as Error & { format: () => string };
      error.format = () => "row 3: name is required\nrow 7: id must be unique";
      const { message, title } = describeTerminalError(error);
      expect(message).toBe("row 3: name is required\nrow 7: id must be unique");
      expect(title).toBe("Error");
    });

    test("handles a thrown non-error value", () => {
      const { message, title } = describeTerminalError("just a string");
      expect(title).toBe("UNKNOWN_ERROR");
      expect(message).toBe("Unknown error: just a string");
    });
  });

  describe("annotateTerminalError", () => {
    test("writes exactly one annotation for a CLIError", () => {
      process.env.GITHUB_ACTIONS = "true";
      const error = CLIError({ message: "boom", code: "DEPLOY_FAILED" });
      const output = captureStderr(() => annotateTerminalError(error, { jsonMode: false }));
      expect(output.match(/^::error/gm)).toHaveLength(1);
      expect(output).toContain("title=DEPLOY_FAILED");
    });

    test("encodes the newlines a formatted CLIError contains", () => {
      process.env.GITHUB_ACTIONS = "true";
      const error = CLIError({ message: "boom", code: "E", details: "line one" });
      const output = captureStderr(() => annotateTerminalError(error, { jsonMode: false }));
      expect(output.endsWith("\n")).toBe(true);
      expect(output.slice(0, -1)).not.toContain("\n");
      expect(output).toContain("%0A");
    });

    test("writes nothing under JSON mode", () => {
      process.env.GITHUB_ACTIONS = "true";
      const output = captureStderr(() =>
        annotateTerminalError(new Error("boom"), { jsonMode: true }),
      );
      expect(output).toBe("");
    });

    test("writes nothing outside GitHub Actions", () => {
      const output = captureStderr(() =>
        annotateTerminalError(new Error("boom"), { jsonMode: false }),
      );
      expect(output).toBe("");
    });
  });
});
