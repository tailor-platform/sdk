import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyContextProfile,
  buildContextProfileInstructions,
  filterSdkTarballForProfile,
} from "./context-profile";

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
  it("removes docs and skills for code-only tarball installs", () => {
    const workDir = makeSdkPackage();

    applyContextProfile(workDir, "code-only");

    const sdkDir = path.join(workDir, "node_modules", "@tailor-platform", "sdk");
    expect(fs.existsSync(path.join(sdkDir, "docs"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "skills"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "CHANGELOG.md"))).toBe(false);
  });

  it("leaves the SDK package untouched for code-and-docs", () => {
    const workDir = makeSdkPackage();

    applyContextProfile(workDir, "code-and-docs");

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

    expect(() => applyContextProfile(workDir, "code-only")).not.toThrow();
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

    applyContextProfile(workDir, "code-only");

    // Files behind the symlink (outside workDir) must remain intact: the
    // isLocalInstalledPackage guard returns false for non-descendant targets.
    expect(fs.existsSync(path.join(externalSdkDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(externalSdkDir, "CHANGELOG.md"))).toBe(true);
    expect(fs.existsSync(path.join(externalSdkDir, "docs", "configuration.md"))).toBe(true);
    expect(fs.existsSync(path.join(externalSdkDir, "skills", "tailor-sdk", "SKILL.md"))).toBe(true);
  });
});

function makeSdkTarball(): string {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-tarball-src-"));
  tmpDirs.push(stagingDir);
  const pkgDir = path.join(stagingDir, "package");
  fs.mkdirSync(path.join(pkgDir, "docs"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "skills", "tailor-sdk"), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"@tailor-platform/sdk"}');
  fs.writeFileSync(path.join(pkgDir, "README.md"), "# SDK\n");
  fs.writeFileSync(path.join(pkgDir, "CHANGELOG.md"), "# Changelog\n");
  fs.writeFileSync(path.join(pkgDir, "docs", "configuration.md"), "# Config\n");
  fs.writeFileSync(path.join(pkgDir, "skills", "tailor-sdk", "SKILL.md"), "# Skill\n");
  fs.writeFileSync(path.join(pkgDir, "dist", "index.mjs"), "export const x = 1;\n");

  const tarballHost = fs.mkdtempSync(path.join(os.tmpdir(), "llm-tarball-out-"));
  tmpDirs.push(tarballHost);
  const tarballPath = path.join(tarballHost, "sdk.tgz");
  execFileSync("tar", ["-czf", tarballPath, "-C", stagingDir, "package"], { stdio: "pipe" });
  return tarballPath;
}

function listTarballEntries(tarballPath: string): string[] {
  const out = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf-8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("filterSdkTarballForProfile", () => {
  it("strips README/CHANGELOG/docs/skills from a code-only tarball but keeps dist", () => {
    const tarballPath = makeSdkTarball();

    filterSdkTarballForProfile(tarballPath, "code-only");

    const entries = listTarballEntries(tarballPath);
    expect(entries.some((e) => e.endsWith("package/dist/index.mjs"))).toBe(true);
    expect(entries.some((e) => e.endsWith("package/package.json"))).toBe(true);
    expect(entries.some((e) => e.includes("package/README.md"))).toBe(false);
    expect(entries.some((e) => e.includes("package/CHANGELOG.md"))).toBe(false);
    expect(entries.some((e) => e.includes("package/docs/"))).toBe(false);
    expect(entries.some((e) => e.includes("package/skills/"))).toBe(false);
  });

  it("leaves a code-and-docs tarball untouched", () => {
    const tarballPath = makeSdkTarball();
    const before = listTarballEntries(tarballPath).sort();

    filterSdkTarballForProfile(tarballPath, "code-and-docs");

    const after = listTarballEntries(tarballPath).sort();
    expect(after).toEqual(before);
  });

  it("is a no-op when the tarball is missing", () => {
    const missing = path.join(os.tmpdir(), `llm-missing-${Date.now()}.tgz`);
    expect(() => filterSdkTarballForProfile(missing, "code-only")).not.toThrow();
  });
});

describe("buildContextProfileInstructions", () => {
  it("describes the code-only profile without referencing docs or skills", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "code-only");

    expect(instructions).toContain("code-only");
    expect(instructions).toContain("TypeScript package API");
  });

  it("describes the code-and-docs profile", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "code-and-docs");

    expect(instructions).toContain("code-and-docs");
  });

  // Profile-swap guard: the code-only payload must not include the
  // code-and-docs opt-in phrasing, and vice versa. If the case bodies are
  // swapped, both negative assertions fail loudly.
  it("does not leak code-and-docs opt-in phrasing into code-only", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "code-only");

    expect(instructions).not.toContain("You may inspect");
    expect(instructions).not.toContain("examples");
    expect(instructions).toContain("Do not rely on");
  });

  it("invites README and docs inspection for code-and-docs", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "code-and-docs");

    expect(instructions).toContain("README");
    expect(instructions).toContain("docs");
    expect(instructions).toContain("You may inspect");
  });
});
