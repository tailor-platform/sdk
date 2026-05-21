import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyContextProfile,
  buildContextProfileInstructions,
  filterSdkTarballForProfile,
  stripBlockComments,
  stripJsdocFromDeclarationFiles,
} from "./context-profile";

const tmpDirs: string[] = [];

function makeSdkPackage(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-context-profile-"));
  tmpDirs.push(dir);
  const sdkDir = path.join(dir, "node_modules", "@tailor-platform", "sdk");
  fs.mkdirSync(path.join(sdkDir, "docs"), { recursive: true });
  fs.mkdirSync(path.join(sdkDir, "skills", "tailor-sdk"), { recursive: true });
  fs.mkdirSync(path.join(sdkDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(sdkDir, "README.md"), "# SDK\n");
  fs.writeFileSync(path.join(sdkDir, "CHANGELOG.md"), "# Changelog\n");
  fs.writeFileSync(path.join(sdkDir, "docs", "configuration.md"), "# Config\n");
  fs.writeFileSync(path.join(sdkDir, "skills", "tailor-sdk", "SKILL.md"), "# Skill\n");
  fs.writeFileSync(
    path.join(sdkDir, "dist", "index.d.mts"),
    [
      '/// <reference types="@tailor-platform/function-types" />',
      "//#region src/foo.d.ts",
      "/**",
      " * Doc that should disappear under bare-types.",
      " * @example doSomething()",
      " */",
      "declare function doSomething(): void;",
      "//#endregion",
      "export { doSomething };",
      "",
    ].join("\n"),
  );
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
    // code-only must keep JSDoc inside .d.mts intact — it's the whole point
    // of separating code-only from bare-types.
    const dts = fs.readFileSync(path.join(sdkDir, "dist", "index.d.mts"), "utf-8");
    expect(dts).toContain("Doc that should disappear under bare-types");
  });

  it("strips JSDoc from .d.mts (and keeps triple-slash + #region) under bare-types", () => {
    const workDir = makeSdkPackage();

    applyContextProfile(workDir, "bare-types");

    const sdkDir = path.join(workDir, "node_modules", "@tailor-platform", "sdk");
    // Same deletion set as code-only.
    expect(fs.existsSync(path.join(sdkDir, "docs"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "skills"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(sdkDir, "CHANGELOG.md"))).toBe(false);
    // JSDoc must be gone; triple-slash directives and #region markers must
    // survive so the type surface still type-checks and stays readable.
    const dts = fs.readFileSync(path.join(sdkDir, "dist", "index.d.mts"), "utf-8");
    expect(dts).not.toContain("Doc that should disappear");
    expect(dts).not.toContain("@example");
    expect(dts).toContain('/// <reference types="@tailor-platform/function-types" />');
    expect(dts).toContain("//#region src/foo.d.ts");
    expect(dts).toContain("declare function doSomething(): void;");
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
  fs.writeFileSync(
    path.join(pkgDir, "dist", "index.d.mts"),
    [
      '/// <reference types="@tailor-platform/function-types" />',
      "/**",
      " * JSDoc to strip under bare-types.",
      " */",
      "declare const x: number;",
      "export { x };",
      "",
    ].join("\n"),
  );

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

  it("strips JSDoc inside .d.mts when re-packing a bare-types tarball", () => {
    const tarballPath = makeSdkTarball();

    filterSdkTarballForProfile(tarballPath, "bare-types");

    // Re-extract the rewritten tarball and read the .d.mts to confirm the
    // JSDoc payload was actually stripped (not just the docs deleted).
    const reextract = fs.mkdtempSync(path.join(os.tmpdir(), "llm-tarball-reextract-"));
    tmpDirs.push(reextract);
    execFileSync("tar", ["-xzf", tarballPath, "-C", reextract], { stdio: "pipe" });
    const dts = fs.readFileSync(path.join(reextract, "package", "dist", "index.d.mts"), "utf-8");
    expect(dts).not.toContain("JSDoc to strip under bare-types");
    expect(dts).toContain('/// <reference types="@tailor-platform/function-types" />');
    expect(dts).toContain("declare const x: number;");
    // README/CHANGELOG/docs/skills are stripped just like code-only.
    const entries = listTarballEntries(tarballPath);
    expect(entries.some((e) => e.includes("package/README.md"))).toBe(false);
    expect(entries.some((e) => e.includes("package/docs/"))).toBe(false);
  });

  it("is a no-op when the tarball is missing", () => {
    const missing = path.join(os.tmpdir(), `llm-missing-${Date.now()}.tgz`);
    expect(() => filterSdkTarballForProfile(missing, "code-only")).not.toThrow();
  });
});

describe("stripBlockComments", () => {
  it("removes /** JSDoc */ blocks", () => {
    const out = stripBlockComments("/** doc */\nconst x = 1;\n");
    expect(out).not.toContain("doc");
    expect(out).toContain("const x = 1;");
  });

  it("removes inline /* */ blocks even when multiple appear on one line", () => {
    const out = stripBlockComments("foo: /** a */ string; bar: /** b */ number;");
    expect(out).not.toMatch(/\/\*/);
    expect(out).toContain("foo:");
    expect(out).toContain("bar:");
  });

  it("preserves triple-slash directives and //#region line comments", () => {
    const input = [
      '/// <reference types="x" />',
      "//#region foo",
      "/** strip me */",
      "declare const y: number;",
      "//#endregion",
    ].join("\n");
    const out = stripBlockComments(input);
    expect(out).toContain('/// <reference types="x" />');
    expect(out).toContain("//#region foo");
    expect(out).toContain("//#endregion");
    expect(out).not.toContain("strip me");
  });

  it("collapses 3+ blank lines down to 2 after stripping", () => {
    const out = stripBlockComments("a\n/** removed */\n\n\n\nb");
    expect(out.split(/b/)[0]!.match(/\n/g)?.length).toBe(2);
  });
});

describe("stripJsdocFromDeclarationFiles", () => {
  it("only touches .d.ts/.d.mts/.d.cts files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-strip-walk-"));
    tmpDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "a.d.ts"),
      "/** keep code-only, drop bare */\nexport const a = 1;\n",
    );
    fs.writeFileSync(path.join(dir, "b.d.mts"), "/** drop */\nexport const b = 1;\n");
    fs.writeFileSync(path.join(dir, "c.d.cts"), "/** drop */\nexport const c = 1;\n");
    fs.writeFileSync(path.join(dir, "d.mjs"), "/** keep — runtime file */\nexport const d = 1;\n");
    fs.writeFileSync(
      path.join(dir, "e.ts"),
      "/** keep — non-declaration */\nexport const e = 1;\n",
    );

    stripJsdocFromDeclarationFiles(dir);

    expect(fs.readFileSync(path.join(dir, "a.d.ts"), "utf-8")).not.toContain("drop bare");
    expect(fs.readFileSync(path.join(dir, "b.d.mts"), "utf-8")).not.toContain("drop");
    expect(fs.readFileSync(path.join(dir, "c.d.cts"), "utf-8")).not.toContain("drop");
    expect(fs.readFileSync(path.join(dir, "d.mjs"), "utf-8")).toContain("keep");
    expect(fs.readFileSync(path.join(dir, "e.ts"), "utf-8")).toContain("keep");
  });

  it("recurses into nested dist/ trees", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-strip-nested-"));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, "dist", "plugin", "kysely-type"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "dist", "plugin", "kysely-type", "index.d.mts"),
      "/** doc */\nexport declare function f(): void;\n",
    );
    stripJsdocFromDeclarationFiles(dir);
    expect(
      fs.readFileSync(path.join(dir, "dist", "plugin", "kysely-type", "index.d.mts"), "utf-8"),
    ).not.toContain("doc");
  });

  it("is a no-op when the directory is missing", () => {
    expect(() => stripJsdocFromDeclarationFiles("/nonexistent-dir-xyz")).not.toThrow();
  });
});

describe("buildContextProfileInstructions", () => {
  it("describes the code-only profile without referencing docs or skills", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "code-only");

    expect(instructions).toContain("code-only");
    expect(instructions).toContain("TypeScript package API");
  });

  it("describes the bare-types profile and steers the agent toward signatures", () => {
    const instructions = buildContextProfileInstructions(makeSdkPackage(), "bare-types");

    expect(instructions).toContain("bare-types");
    expect(instructions).toContain("type signatures");
    expect(instructions).toContain("no JSDoc");
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
