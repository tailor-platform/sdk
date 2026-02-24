import { describe, expect, it } from "vitest";
import { cleanEnv } from "./shared";

describe("cleanEnv", () => {
  it("strips CLAUDE_CODE_ prefixed variables", () => {
    process.env.CLAUDE_CODE_TEST_VAR = "value";
    try {
      const env = cleanEnv();
      expect(env.CLAUDE_CODE_TEST_VAR).toBeUndefined();
    } finally {
      delete process.env.CLAUDE_CODE_TEST_VAR;
    }
  });

  it("strips path-leaking variables", () => {
    const original = {
      npm_config_local_prefix: process.env.npm_config_local_prefix,
      npm_package_json: process.env.npm_package_json,
      TURBO_HASH: process.env.TURBO_HASH,
    };
    process.env.npm_config_local_prefix = "/some/path";
    process.env.npm_package_json = "/some/path/package.json";
    process.env.TURBO_HASH = "abc123";
    try {
      const env = cleanEnv();
      expect(env.npm_config_local_prefix).toBeUndefined();
      expect(env.npm_package_json).toBeUndefined();
      expect(env.TURBO_HASH).toBeUndefined();
    } finally {
      if (original.npm_config_local_prefix !== undefined) {
        process.env.npm_config_local_prefix = original.npm_config_local_prefix;
      } else {
        delete process.env.npm_config_local_prefix;
      }
      if (original.npm_package_json !== undefined) {
        process.env.npm_package_json = original.npm_package_json;
      } else {
        delete process.env.npm_package_json;
      }
      if (original.TURBO_HASH !== undefined) {
        process.env.TURBO_HASH = original.TURBO_HASH;
      } else {
        delete process.env.TURBO_HASH;
      }
    }
  });

  it("strips PWD when it contains llm-challenge", () => {
    const originalPwd = process.env.PWD;
    process.env.PWD = "/Users/test/ghq/github.com/repo/llm-challenge";
    try {
      const env = cleanEnv();
      expect(env.PWD).toBeUndefined();
    } finally {
      if (originalPwd !== undefined) {
        process.env.PWD = originalPwd;
      } else {
        delete process.env.PWD;
      }
    }
  });

  it("always strips PWD to prevent leaking parent process paths", () => {
    const originalPwd = process.env.PWD;
    process.env.PWD = "/Users/test/projects/my-app";
    try {
      const env = cleanEnv();
      expect(env.PWD).toBeUndefined();
    } finally {
      if (originalPwd !== undefined) {
        process.env.PWD = originalPwd;
      } else {
        delete process.env.PWD;
      }
    }
  });

  it("strips node_modules/.bin entries from PATH to prevent repo path leak", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = [
      "/usr/local/bin",
      "/Users/test/ghq/repo/node_modules/.bin",
      "/opt/homebrew/bin",
      "/Users/test/ghq/repo/llm-challenge/node_modules/.bin",
    ].join(":");
    try {
      const env = cleanEnv();
      const entries = env.PATH?.split(":") ?? [];
      expect(entries).toContain("/usr/local/bin");
      expect(entries).toContain("/opt/homebrew/bin");
      expect(entries).not.toContain("/Users/test/ghq/repo/node_modules/.bin");
      expect(entries).not.toContain("/Users/test/ghq/repo/llm-challenge/node_modules/.bin");
    } finally {
      if (originalPath !== undefined) {
        process.env.PATH = originalPath;
      } else {
        delete process.env.PATH;
      }
    }
  });

  it("strips node_modules entries with backslash separators from PATH", () => {
    const originalPath = process.env.PATH;
    // Use a path with backslash directory separator (Windows-style) but
    // without drive letter "C:" which would be broken by the ":" split
    // on Unix. This tests the filter logic for backslash paths.
    process.env.PATH = [
      "/usr/local/bin",
      "/Users/test/repo/node_modules\\.bin",
      "/opt/homebrew/bin",
    ].join(":");
    try {
      const env = cleanEnv();
      const entries = env.PATH?.split(":") ?? [];
      expect(entries).toContain("/usr/local/bin");
      expect(entries).toContain("/opt/homebrew/bin");
      expect(entries).not.toContain("/Users/test/repo/node_modules\\.bin");
    } finally {
      if (originalPath !== undefined) {
        process.env.PATH = originalPath;
      } else {
        delete process.env.PATH;
      }
    }
  });

  it("strips INIT_CWD to prevent leaking npm/pnpm invocation path", () => {
    const original = process.env.INIT_CWD;
    process.env.INIT_CWD = "/Users/test/ghq/github.com/repo";
    try {
      const env = cleanEnv();
      expect(env.INIT_CWD).toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.INIT_CWD = original;
      } else {
        delete process.env.INIT_CWD;
      }
    }
  });
});
