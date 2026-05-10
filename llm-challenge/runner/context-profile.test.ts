import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyContextProfile, buildContextProfileInstructions } from "./context-profile";

const tmpDirs: string[] = [];

function makeSdkPackage(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-context-profile-"));
  tmpDirs.push(dir);
  const sdkDir = path.join(dir, "node_modules", "@tailor-platform", "sdk");
  fs.mkdirSync(path.join(sdkDir, "docs"), { recursive: true });
  fs.mkdirSync(path.join(sdkDir, "skills", "tailor-sdk"), { recursive: true });
  fs.writeFileSync(path.join(sdkDir, "README.md"), "# SDK\n");
  fs.writeFileSync(path.join(sdkDir, "CHANGELOG.md"), "# Changelog\n");
  fs.writeFileSync(path.join(sdkDir, "docs", "configuration.md"), "# Config\n");
  fs.writeFileSync(path.join(sdkDir, "skills", "tailor-sdk", "SKILL.md"), "# Skill\n");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("applyContextProfile", () => {
  it("removes docs and skills for types-only tarball installs", () => {
    const workDir = makeSdkPackage();

    applyContextProfile(workDir, "types-only");

    const sdkDir = path.join(workDir, "node_modules", "@tailor-platform", "sdk");
    expect(fs.existsSync(path.join(sdkDir, "docs"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "skills"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "CHANGELOG.md"))).toBe(false);
  });

  it("keeps docs but removes skills for docs-only", () => {
    const workDir = makeSdkPackage();

    applyContextProfile(workDir, "docs-only");

    const sdkDir = path.join(workDir, "node_modules", "@tailor-platform", "sdk");
    expect(fs.existsSync(path.join(sdkDir, "docs", "configuration.md"))).toBe(true);
    expect(fs.existsSync(path.join(sdkDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(sdkDir, "skills"))).toBe(false);
  });
});

describe("buildContextProfileInstructions", () => {
  it("embeds the installed tailor-sdk skill for the skill profile", () => {
    const workDir = makeSdkPackage();

    const instructions = buildContextProfileInstructions(workDir, "tailor-sdk-skill");

    expect(instructions).toContain("tailor-sdk skill");
    expect(instructions).toContain("# Skill");
  });
});
