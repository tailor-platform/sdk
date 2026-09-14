import { color } from "@tailor-platform/shared/color";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { withErrorDiagnostics } from "./error-diagnostics";
import { CLIError } from "./errors";
import {
  annotateTerminalError,
  annotationsEnabled,
  describeTerminalError,
  formatAnnotation,
  workspaceRelativePath,
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

    test("is off when --json is in argv but its effect has not run yet", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "crashreport", "send", "--json"]);
      expect(annotationsEnabled(false)).toBe(false);
    });

    test("is off for the -j alias in argv", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "workspace", "list", "-j"]);
      expect(annotationsEnabled(false)).toBe(false);
    });

    test.each(["--json=true", "-j=true", "--json=1"])("is off for the %s form", (flag) => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "crashreport", "send", flag]);
      expect(annotationsEnabled(false)).toBe(false);
    });

    test("stays on for an explicitly disabled json flag", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "deploy", "--json=false"]);
      expect(annotationsEnabled(false)).toBe(true);
    });

    test("does not treat an unrelated flag ending in json as the json flag", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "deploy", "--no-json", "--jsonish"]);
      expect(annotationsEnabled(false)).toBe(true);
    });

    test("stays on when json appears only after the end-of-options separator", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "workspace", "list", "--", "--json"]);
      expect(annotationsEnabled(false)).toBe(true);
    });

    test("is off for a real json flag preceding the separator", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "seed", "validate", "--json", "--", "zzz"]);
      expect(annotationsEnabled(false)).toBe(false);
    });

    test("stays on when argv has no json flag", () => {
      process.env.GITHUB_ACTIONS = "true";
      using argv = vi.spyOn(process, "argv", "get");
      argv.mockReturnValue(["node", "tailor", "deploy", "--yes"]);
      expect(annotationsEnabled(false)).toBe(true);
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

    test("falls back to CLI_ERROR when a CLIError carries an empty code", () => {
      expect(describeTerminalError(CLIError({ code: "", message: "boom" })).title).toBe(
        "CLI_ERROR",
      );
    });

    test("falls back to Error when the error name is empty", () => {
      const error = new Error("boom");
      error.name = "";
      expect(describeTerminalError(error).title).toBe("Error");
    });

    test("prefers a diagnostics code over the error name for the title", () => {
      const error = withErrorDiagnostics(new Error("transport gone"), {
        code: "TRANSPORT_DISCONNECTED",
      });
      expect(describeTerminalError(error).title).toBe("TRANSPORT_DISCONNECTED");
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

    test("falls back to the message when format() does not return a string", () => {
      const error = Object.assign(new Error("fallback message"), {
        format: () => ({ _errors: [] }),
      });
      expect(describeTerminalError(error).message).toBe("fallback message");
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

    test("carries a workspace-relative file and line from the error's location", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_WORKSPACE = "/repo";
      const error = withErrorDiagnostics(new Error("bad row"), {
        code: "SEED_INVALID",
        location: { file: "/repo/seed/data/User.jsonl", line: 4 },
      });
      const output = captureStderr(() => annotateTerminalError(error, { jsonMode: false }));
      expect(output).toContain("file=seed/data/User.jsonl");
      expect(output).toContain("line=4");
      expect(output).toContain("title=SEED_INVALID");
    });

    test("omits line when the location carries only a file", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_WORKSPACE = "/repo";
      const error = withErrorDiagnostics(new Error("bad config"), {
        location: { file: "/repo/tailor.config.ts" },
      });
      const output = captureStderr(() => annotateTerminalError(error, { jsonMode: false }));
      expect(output).toContain("file=tailor.config.ts");
      expect(output).not.toContain("line=");
    });

    test("still annotates, without a location, when the file is outside the workspace", () => {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_WORKSPACE = "/repo";
      const error = withErrorDiagnostics(new Error("bad row"), {
        location: { file: "/elsewhere/User.jsonl", line: 2 },
      });
      const output = captureStderr(() => annotateTerminalError(error, { jsonMode: false }));
      expect(output).toContain("bad row");
      expect(output).not.toContain("file=");
      expect(output).not.toContain("line=");
    });

    test("writes nothing outside GitHub Actions", () => {
      const output = captureStderr(() =>
        annotateTerminalError(new Error("boom"), { jsonMode: false }),
      );
      expect(output).toBe("");
    });
  });

  describe("workspaceRelativePath", () => {
    test("returns undefined when GITHUB_WORKSPACE is unset", () => {
      expect(workspaceRelativePath("/repo/src/a.ts")).toBeUndefined();
    });

    test("relativizes a path inside the workspace", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/repo/src/a.ts")).toBe("src/a.ts");
    });

    test("returns undefined for a path outside the workspace", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/elsewhere/a.ts")).toBeUndefined();
    });

    test("does not treat a sibling with a shared prefix as inside", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/repo-other/a.ts")).toBeUndefined();
    });

    test("returns undefined for the workspace directory itself", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/repo")).toBeUndefined();
    });

    test("emits forward slashes regardless of input separators", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/repo/src/nested/a.ts")).toBe("src/nested/a.ts");
    });

    test("keeps a directory whose name merely starts with dots", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/repo/..data/a.ts")).toBe("..data/a.ts");
    });

    test("resolves dot segments before deciding containment", () => {
      process.env.GITHUB_WORKSPACE = "/repo";
      expect(workspaceRelativePath("/repo/src/../src/a.ts")).toBe("src/a.ts");
      expect(workspaceRelativePath("/repo/../secret.ts")).toBeUndefined();
    });
  });
});
