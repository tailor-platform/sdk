import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  buildCodexDenylistRules,
  ensureCodexDenylistRules,
  estimateCodexMaxOutputTokens,
  interpretCodexAuthStatus,
  interpretCodexRunStatus,
} from "./codex";

describe("estimateCodexMaxOutputTokens", () => {
  it("reserves a buffer from max budget", () => {
    expect(estimateCodexMaxOutputTokens(2)).toBe(160_000);
  });

  it("returns a practical minimum for very small budgets", () => {
    expect(estimateCodexMaxOutputTokens(0.0001)).toBe(32);
  });
});

describe("buildCodexDenylistRules", () => {
  it("blocks broad file-discovery commands", () => {
    const rules = buildCodexDenylistRules();

    expect(rules).toContain('"find", "/"');
    expect(rules).toContain('"find", "/Users"');
    expect(rules).toContain('"find", "/home"');
    expect(rules).toContain('"find", "/tmp"');
    expect(rules).toContain('"locate"');
    expect(rules).toContain('"mdfind"');
    expect(rules).toContain('"fd", "/"');
  });

  it("blocks absolute path variants of discovery commands", () => {
    const rules = buildCodexDenylistRules();

    // Models can bypass bare command rules by using absolute paths
    // e.g. /usr/bin/find / instead of find /
    expect(rules).toContain('"/usr/bin/find"');
    expect(rules).toContain('"/usr/bin/locate"');
    expect(rules).toContain('"/usr/bin/mdfind"');
  });

  it("blocks discovery commands with common leading options", () => {
    const rules = buildCodexDenylistRules();

    // find -L / and find -H / bypass ["find", "/"] since the second token
    // is an option, not the path. Rules should cover these variants.
    expect(rules).toContain('"find", "-L"');
    expect(rules).toContain('"find", "-H"');
    expect(rules).toContain('"find", "-P"');
  });

  it("does not leak the challenge root absolute path", () => {
    const rules = buildCodexDenylistRules();
    // The challenge root is under llm-challenge/ relative to repo root.
    // Rules must NOT embed the absolute path, as Codex can read the rules
    // file and recover the path, undermining the obfuscation defense.
    const challengeRoot = path.resolve(import.meta.dirname, "..", "..");
    expect(rules).not.toContain(challengeRoot);
  });

  it("blocks home directory subpath scans", () => {
    const rules = buildCodexDenylistRules();
    const homeDir = os.homedir().replaceAll(path.sep, "/");
    // Should block find commands targeting the user's home directory
    expect(rules).toContain(`"find", "${homeDir}"`);
  });

  it("marks all rules as forbidden", () => {
    const rules = buildCodexDenylistRules();

    expect(rules).toContain('decision = "forbidden"');
    expect(rules).toContain('justification = "Benchmark artifact access is forbidden."');
  });

  it("produces a compact ruleset", () => {
    const rules = buildCodexDenylistRules();
    const ruleLines = rules.split("\n").filter((line) => line.startsWith("prefix_rule("));

    // Should be far fewer than the old approach (~500+ rules)
    // With absolute path variants (~60-70 rules) but still compact.
    expect(ruleLines.length).toBeGreaterThan(10);
    expect(ruleLines.length).toBeLessThan(100);
  });
});

describe("ensureCodexDenylistRules", () => {
  it("creates rules file in workDir", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-"));
    const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
    try {
      ensureCodexDenylistRules(workDir);

      expect(fs.existsSync(rulesPath)).toBe(true);
      const content = fs.readFileSync(rulesPath, "utf-8");
      expect(content).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("overwrites existing rules to prevent tampering across retries", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-overwrite-"));
    const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
    try {
      ensureCodexDenylistRules(workDir);
      fs.writeFileSync(rulesPath, "tampered-marker\n", "utf-8");

      ensureCodexDenylistRules(workDir);

      const content = fs.readFileSync(rulesPath, "utf-8");
      expect(content).not.toBe("tampered-marker\n");
      expect(content).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("does not follow symlinks when writing rules file", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-symlink-"));
    const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
    const externalFile = path.join(workDir, "external-target.txt");
    try {
      // First call creates the rules file normally
      ensureCodexDenylistRules(workDir);

      // Simulate Codex replacing the rules file with a symlink to an external file
      fs.writeFileSync(externalFile, "original-content\n", "utf-8");
      fs.unlinkSync(rulesPath);
      fs.symlinkSync(externalFile, rulesPath);

      // Second call (retry) should NOT follow the symlink
      ensureCodexDenylistRules(workDir);

      // The external file should be untouched
      expect(fs.readFileSync(externalFile, "utf-8")).toBe("original-content\n");
      // The rules file should be a regular file, not a symlink
      expect(fs.lstatSync(rulesPath).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(rulesPath, "utf-8")).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite external files via hard links", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-hardlink-"));
    const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
    const externalFile = path.join(workDir, "external-target.txt");
    try {
      // First call creates the rules file normally
      ensureCodexDenylistRules(workDir);

      // Simulate Codex replacing the rules file with a hard link to an external file
      fs.writeFileSync(externalFile, "original-content\n", "utf-8");
      fs.unlinkSync(rulesPath);
      fs.linkSync(externalFile, rulesPath);

      // Second call (retry) should NOT overwrite the external file via hard link
      ensureCodexDenylistRules(workDir);

      // The external file should be untouched
      expect(fs.readFileSync(externalFile, "utf-8")).toBe("original-content\n");
      // The rules file should contain valid rules
      expect(fs.readFileSync(rulesPath, "utf-8")).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("recovers when .codex is replaced with a regular file", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-fileblock-"));
    const codexDir = path.join(workDir, ".codex");
    try {
      ensureCodexDenylistRules(workDir);

      // Simulate Codex replacing .codex directory with a regular file
      fs.rmSync(codexDir, { recursive: true });
      fs.writeFileSync(codexDir, "blocking-file\n", "utf-8");

      // Should not throw ENOTDIR
      ensureCodexDenylistRules(workDir);

      expect(fs.lstatSync(codexDir).isDirectory()).toBe(true);
      const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
      expect(fs.readFileSync(rulesPath, "utf-8")).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("recovers when .codex/rules is replaced with a regular file", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-rulesfileblock-"));
    const rulesDir = path.join(workDir, ".codex", "rules");
    try {
      ensureCodexDenylistRules(workDir);

      // Simulate Codex replacing the rules directory with a regular file
      fs.rmSync(rulesDir, { recursive: true });
      fs.writeFileSync(rulesDir, "blocking-file\n", "utf-8");

      // Should not throw ENOTDIR
      ensureCodexDenylistRules(workDir);

      expect(fs.lstatSync(rulesDir).isDirectory()).toBe(true);
      const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
      expect(fs.readFileSync(rulesPath, "utf-8")).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("recovers when rules file path is replaced with a directory", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-rulesdir-"));
    const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
    try {
      ensureCodexDenylistRules(workDir);

      // Simulate Codex replacing the rules file with a directory
      fs.unlinkSync(rulesPath);
      fs.mkdirSync(rulesPath, { recursive: true });

      // Should not throw EISDIR / ENOTEMPTY
      ensureCodexDenylistRules(workDir);

      expect(fs.lstatSync(rulesPath).isFile()).toBe(true);
      expect(fs.readFileSync(rulesPath, "utf-8")).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("does not follow symlinked directories in .codex path", () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rules-dirlink-"));
    const externalDir = path.join(workDir, "external-dir");
    const codexDir = path.join(workDir, ".codex");
    try {
      // First call creates the directory structure normally
      ensureCodexDenylistRules(workDir);

      // Simulate Codex replacing .codex directory with a symlink
      fs.rmSync(codexDir, { recursive: true });
      fs.mkdirSync(externalDir, { recursive: true });
      fs.symlinkSync(externalDir, codexDir);

      // Second call should not follow the directory symlink
      ensureCodexDenylistRules(workDir);

      // .codex should be a real directory, not a symlink
      expect(fs.lstatSync(codexDir).isSymbolicLink()).toBe(false);
      // The rules file should exist and be valid
      const rulesPath = path.join(workDir, ".codex", "rules", "llm-challenge-denylist.rules");
      expect(fs.readFileSync(rulesPath, "utf-8")).toContain("prefix_rule(");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe("interpretCodexAuthStatus", () => {
  it("treats auth check as success when a turn completes even if exit code is non-zero", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"ok"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}',
      '{"type":"error","message":"Failed to shutdown rollout recorder"}',
    ].join("\n");
    const stderr =
      "WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)";

    expect(interpretCodexAuthStatus({ code: 1, stdout, stderr })).toEqual({
      ok: true,
    });
  });

  it("returns failure when no completed turn is present", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"turn.failed","error":{"message":"authentication failed"}}',
    ].join("\n");

    expect(interpretCodexAuthStatus({ code: 1, stdout, stderr: "" })).toEqual({
      ok: false,
      error: "authentication failed",
    });
  });
});

describe("interpretCodexRunStatus", () => {
  it("treats solve runs as success when a turn completes even if exit code is non-zero", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}',
      '{"type":"error","message":"Failed to shutdown rollout recorder"}',
    ].join("\n");
    const stderr =
      "WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)";

    expect(
      interpretCodexRunStatus({
        code: 1,
        stdout,
        stderr,
        output: stdout,
      }),
    ).toMatchObject({
      success: true,
      message: "done",
      error: undefined,
    });
  });

  it("keeps turn.failed reason even when a trailing generic error event exists", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"turn.failed","error":{"message":"authentication failed"}}',
      '{"type":"error","message":"Failed to shutdown rollout recorder"}',
    ].join("\n");

    expect(
      interpretCodexRunStatus({
        code: 1,
        stdout,
        stderr: "",
        output: stdout,
      }),
    ).toMatchObject({
      success: false,
      error: "authentication failed",
    });
  });
});
