import * as fs from "node:fs";
import * as os from "node:os";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { describe, expect, beforeEach, afterEach, test, vi } from "vitest";
import {
  loadEnvFiles,
  durationArg,
  parseDuration,
  positiveIntArg,
  resolveMachineUserInputSource,
  toPageDirection,
} from "./args";

describe("loadEnvFiles", () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-env-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("required env files (envFiles)", () => {
    test("loads environment variables from existing file", () => {
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "TEST_VAR=hello\nANOTHER_VAR=world");

      loadEnvFiles(".env", undefined);

      expect(process.env.TEST_VAR).toBe("hello");
      expect(process.env.ANOTHER_VAR).toBe("world");
    });

    test("throws error when required file does not exist", () => {
      expect(() => loadEnvFiles("nonexistent.env", undefined)).toThrow(
        /Environment file not found/,
      );
    });

    test("loads multiple files from array", () => {
      const env1Path = path.join(tempDir, ".env.1");
      const env2Path = path.join(tempDir, ".env.2");
      fs.writeFileSync(env1Path, "VAR_FROM_1=value1");
      fs.writeFileSync(env2Path, "VAR_FROM_2=value2");

      loadEnvFiles([".env.1", ".env.2"], undefined);

      expect(process.env.VAR_FROM_1).toBe("value1");
      expect(process.env.VAR_FROM_2).toBe("value2");
    });
  });

  describe("optional env files (envFilesIfExists)", () => {
    test("loads environment variables from existing file", () => {
      const envPath = path.join(tempDir, ".env.local");
      fs.writeFileSync(envPath, "LOCAL_VAR=local_value");

      loadEnvFiles(undefined, ".env.local");

      expect(process.env.LOCAL_VAR).toBe("local_value");
    });

    test("does not throw when optional file does not exist", () => {
      expect(() => loadEnvFiles(undefined, "nonexistent.env")).not.toThrow();
    });

    test("loads existing files and skips non-existing ones from array", () => {
      const envPath = path.join(tempDir, ".env.exists");
      fs.writeFileSync(envPath, "EXISTS_VAR=exists");

      loadEnvFiles(undefined, [".env.exists", ".env.missing"]);

      expect(process.env.EXISTS_VAR).toBe("exists");
    });
  });

  describe("environment variable behavior (follows Node.js --env-file since v20.7.0)", () => {
    test("does NOT overwrite pre-existing environment variables", () => {
      process.env.PREEXISTING_VAR = "original";
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "PREEXISTING_VAR=from_file");

      loadEnvFiles(".env", undefined);

      expect(process.env.PREEXISTING_VAR).toBe("original");
    });

    test("allows later env files to override earlier ones", () => {
      const env1Path = path.join(tempDir, ".env.1");
      const env2Path = path.join(tempDir, ".env.2");
      fs.writeFileSync(env1Path, "SHARED_VAR=from_first");
      fs.writeFileSync(env2Path, "SHARED_VAR=from_second");

      loadEnvFiles([".env.1", ".env.2"], undefined);

      expect(process.env.SHARED_VAR).toBe("from_second");
    });

    test("allows optional files to override required files", () => {
      const requiredEnv = path.join(tempDir, ".env");
      const optionalEnv = path.join(tempDir, ".env.local");
      fs.writeFileSync(requiredEnv, "SHARED_VAR=from_required");
      fs.writeFileSync(optionalEnv, "SHARED_VAR=from_optional");

      loadEnvFiles(".env", ".env.local");

      expect(process.env.SHARED_VAR).toBe("from_optional");
    });

    test("sets new variables while preserving pre-existing ones", () => {
      process.env.EXISTING = "keep_me";
      const envPath = path.join(tempDir, ".env");
      fs.writeFileSync(envPath, "EXISTING=try_to_override\nNEW_VAR=new_value");

      loadEnvFiles(".env", undefined);

      expect(process.env.EXISTING).toBe("keep_me");
      expect(process.env.NEW_VAR).toBe("new_value");
    });
  });

  describe("edge cases", () => {
    test("handles undefined for both arguments", () => {
      expect(() => loadEnvFiles(undefined, undefined)).not.toThrow();
    });

    test("handles empty arrays", () => {
      expect(() => loadEnvFiles([], [])).not.toThrow();
    });
  });
});

describe("durationArg", () => {
  test("validates and returns duration string as-is", () => {
    expect(durationArg.parse("3s")).toBe("3s");
    expect(durationArg.parse("500ms")).toBe("500ms");
    expect(durationArg.parse("1m")).toBe("1m");
  });

  test.each(["3", "3x", "abc", ""])("rejects invalid format: %s", (value) => {
    expect(() => durationArg.parse(value)).toThrow(
      /Invalid duration format|Cannot read properties of null/,
    );
  });

  test.each(["0ms", "0s", "0m"])("rejects zero duration: %s", (value) => {
    expect(() => durationArg.parse(value)).toThrow(/Duration must be greater than 0/);
  });
});

describe("parseDuration", () => {
  test.each([
    ["3s", 3000],
    ["1s", 1000],
    ["500ms", 500],
    ["1ms", 1],
    ["1m", 60000],
    ["2m", 120000],
  ])("parses %s to %d ms", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });
});

describe("positiveIntArg", () => {
  test("parses positive integers", () => {
    expect(positiveIntArg.parse("1")).toBe(1);
    expect(positiveIntArg.parse("100")).toBe(100);
  });

  test("coerces numbers", () => {
    expect(positiveIntArg.parse(5)).toBe(5);
  });

  test("rejects zero", () => {
    expect(() => positiveIntArg.parse("0")).toThrow(/Too small/);
  });

  test("rejects negative numbers", () => {
    expect(() => positiveIntArg.parse("-1")).toThrow(/Too small/);
  });

  test("rejects non-integers", () => {
    expect(() => positiveIntArg.parse("1.5")).toThrow(/Invalid input/);
  });
});

describe("toPageDirection", () => {
  test("returns undefined when order is undefined", () => {
    expect(toPageDirection(undefined)).toBeUndefined();
  });

  test("maps asc to PageDirection.ASC", () => {
    expect(toPageDirection("asc")).toBe(PageDirection.ASC);
  });

  test("maps desc to PageDirection.DESC", () => {
    expect(toPageDirection("desc")).toBe(PageDirection.DESC);
  });
});

describe("resolveMachineUserInputSource", () => {
  beforeEach(() => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns undefined when no machine user value was parsed", () => {
    expect(resolveMachineUserInputSource(undefined, ["query"])).toBeUndefined();
  });

  test.each([
    ["long option", ["query", "--machine-user", "bot"]],
    ["long option with value", ["query", "--machine-user=bot"]],
    ["camel-case long option", ["query", "--machineUser", "bot"]],
    ["hidden alias", ["query", "--machineuser", "bot"]],
    ["short option", ["query", "-m", "bot"]],
    ["short option with value", ["query", "-m=bot"]],
  ])("reports option source for %s", (_label, argv) => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(resolveMachineUserInputSource("bot", argv)).toBe("option");
  });

  test("reports env source when value matches env and no flag is present", () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(resolveMachineUserInputSource("bot", ["query"])).toBe("env");
  });

  test("does not scan arguments after --", () => {
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "bot");
    expect(resolveMachineUserInputSource("bot", ["query", "--", "--machine-user", "bot"])).toBe(
      "env",
    );
  });
});
