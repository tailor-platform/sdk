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

  it("leaves the SDK package untouched for full-package", () => {
    const workDir = makeSdkPackage();

    applyContextProfile(workDir, "full-package");

    const sdkDir = path.join(workDir, "node_modules", "@tailor-platform", "sdk");
    expect(fs.existsSync(path.join(sdkDir, "docs", "configuration.md"))).toBe(true);
    expect(fs.existsSync(path.join(sdkDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(sdkDir, "CHANGELOG.md"))).toBe(true);
    expect(fs.existsSync(path.join(sdkDir, "skills", "tailor-sdk", "SKILL.md"))).toBe(true);
  });

  it("no-ops when the SDK package is not installed locally under workDir", () => {
    // workDir has no node_modules/@tailor-platform/sdk -- nothing to do, and no throw.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-context-profile-empty-"));
    tmpDirs.push(workDir);

    expect(() => applyContextProfile(workDir, "types-only")).not.toThrow();
  });

  it("leaves the SDK intact when node_modules/.../sdk symlinks outside workDir", () => {
    // External SDK location (outside workDir): the isLocalInstalledPackage
    // guard must refuse to delete files behind a symlink to here.
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-context-profile-external-"));
    tmpDirs.push(externalRoot);
    const externalSdkDir = path.join(externalRoot, "sdk");
    fs.mkdirSync(path.join(externalSdkDir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(externalSdkDir, "skills", "tailor-sdk"), { recursive: true });
    fs.writeFileSync(path.join(externalSdkDir, "README.md"), "# SDK\n");
    fs.writeFileSync(path.join(externalSdkDir, "CHANGELOG.md"), "# Changelog\n");
    fs.writeFileSync(path.join(externalSdkDir, "docs", "configuration.md"), "# Config\n");
    fs.writeFileSync(path.join(externalSdkDir, "skills", "tailor-sdk", "SKILL.md"), "# Skill\n");

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-context-profile-symlink-"));
    tmpDirs.push(workDir);
    const sdkParent = path.join(workDir, "node_modules", "@tailor-platform");
    fs.mkdirSync(sdkParent, { recursive: true });
    const symlinkedSdk = path.join(sdkParent, "sdk");
    fs.symlinkSync(externalSdkDir, symlinkedSdk, "dir");

    applyContextProfile(workDir, "types-only");

    // Files behind the symlink (outside workDir) must remain intact: the
    // isLocalInstalledPackage guard returns false for non-descendant targets.
    expect(fs.existsSync(path.join(externalSdkDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(externalSdkDir, "CHANGELOG.md"))).toBe(true);
    expect(fs.existsSync(path.join(externalSdkDir, "docs", "configuration.md"))).toBe(true);
    expect(fs.existsSync(path.join(externalSdkDir, "skills", "tailor-sdk", "SKILL.md"))).toBe(true);
  });
});

describe("buildContextProfileInstructions", () => {
  it("describes the types-only profile without referencing docs or skills", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "types-only");

    expect(instructions).toContain("types-only");
    expect(instructions).toContain("TypeScript package API");
  });

  it("describes the full-package profile", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "full-package");

    expect(instructions).toContain("full-package");
  });

  // Profile-swap guard: the types-only payload must not include the
  // full-package opt-in phrasing, and vice versa. If the case bodies are
  // swapped, both negative assertions fail loudly.
  it("does not leak full-package opt-in phrasing into types-only", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "types-only");

    expect(instructions).not.toContain("You may inspect");
    expect(instructions).not.toContain("examples");
    expect(instructions).toContain("Do not rely on");
  });

  it("invites README and docs inspection for full-package", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "full-package");

    expect(instructions).toContain("README");
    expect(instructions).toContain("docs");
    expect(instructions).toContain("You may inspect");
  });
});
