import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ContextProfile = "code-only" | "code-and-docs" | "bare-types";

export const contextProfileValues = [
  "code-only",
  "code-and-docs",
  "bare-types",
] as const satisfies readonly ContextProfile[];

export function isContextProfile(value: unknown): value is ContextProfile {
  return typeof value === "string" && (contextProfileValues as readonly string[]).includes(value);
}

// `code-only` strips README/CHANGELOG/docs/skills from the installed SDK so
// the agent must rely solely on the TypeScript surface.
// `bare-types` is `code-only` plus JSDoc removal from `.d.{ts,mts,cts}` so the
// agent must rely on the type *shape* alone — used to measure whether the API
// design is self-evident independent of documentation effort.
// `code-and-docs` is unfiltered.
const removableEntriesByProfile: Record<ContextProfile, readonly string[]> = {
  "code-only": ["README.md", "CHANGELOG.md", "docs", "skills"],
  "bare-types": ["README.md", "CHANGELOG.md", "docs", "skills"],
  "code-and-docs": [],
};

function getInstalledSdkDir(workDir: string): string {
  return path.join(workDir, "node_modules", "@tailor-platform", "sdk");
}

function isLocalInstalledPackage(workDir: string, sdkDir: string): boolean {
  if (!fs.existsSync(sdkDir)) {
    return false;
  }
  const realWorkDir = fs.realpathSync(workDir);
  const realSdkDir = fs.realpathSync(sdkDir);
  const relative = path.relative(realWorkDir, realSdkDir);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function applyContextProfile(workDir: string, profile: ContextProfile): void {
  const entries = removableEntriesByProfile[profile];
  const needsJsdocStrip = profile === "bare-types";
  if (entries.length === 0 && !needsJsdocStrip) {
    return;
  }
  const sdkDir = getInstalledSdkDir(workDir);
  if (!isLocalInstalledPackage(workDir, sdkDir)) {
    return;
  }
  for (const entry of entries) {
    fs.rmSync(path.join(sdkDir, entry), { recursive: true, force: true });
  }
  if (needsJsdocStrip) {
    stripJsdocFromDeclarationFiles(sdkDir);
  }
}

/**
 * Strip `/* ... *\/` block comments (which includes JSDoc) from every
 * TypeScript declaration file under `pkgDir`. Line comments (`//`, `///`
 * triple-slash references, `//#region` markers) are preserved.
 *
 * Used by the `bare-types` profile to force the agent to read raw type
 * signatures without the JSDoc cushion.
 */
export function stripJsdocFromDeclarationFiles(pkgDir: string): void {
  if (!fs.existsSync(pkgDir)) return;
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        visit(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!/\.d\.(ts|mts|cts)$/.test(ent.name)) continue;
      let source: string;
      try {
        source = fs.readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const stripped = stripBlockComments(source);
      if (stripped !== source) {
        fs.writeFileSync(full, stripped);
      }
    }
  };
  visit(pkgDir);
}

/**
 * Remove every `/* ... *\/` block comment from `source`. Non-greedy, multiline.
 * Preserves line comments (`//`) including triple-slash directives.
 *
 * Limitation: does not parse the string-literal state, so the rare case of
 * `/*` appearing inside a TypeScript string literal would be mis-handled.
 * `.d.{ts,mts,cts}` files contain almost no string literals (declarations
 * only), so this is acceptable for the harness's purpose.
 */
export function stripBlockComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Collapse 3+ consecutive newlines down to 2 so the stripped file stays
  // readable rather than gaining huge gaps where JSDoc blocks lived.
  return withoutBlocks.replace(/\n{3,}/g, "\n\n");
}

/**
 * Rewrite the SDK tarball at `tarballPath` so its content matches the context
 * profile: code-only strips README/CHANGELOG/docs/skills before re-packing.
 *
 * Necessary because the harness leaves `.sdk/sdk.tgz` in the workspace so the
 * `package.json` `file:` reference stays consistent if the solver re-runs
 * `pnpm install`. Without filtering, re-install would silently restore docs.
 */
export function filterSdkTarballForProfile(tarballPath: string, profile: ContextProfile): void {
  const entries = removableEntriesByProfile[profile];
  const needsJsdocStrip = profile === "bare-types";
  if ((entries.length === 0 && !needsJsdocStrip) || !fs.existsSync(tarballPath)) {
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-sdk-filter-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", tmpDir], { stdio: "pipe" });
    const pkgDir = path.join(tmpDir, "package");
    for (const entry of entries) {
      fs.rmSync(path.join(pkgDir, entry), { recursive: true, force: true });
    }
    if (needsJsdocStrip) {
      stripJsdocFromDeclarationFiles(pkgDir);
    }
    execFileSync("tar", ["-czf", tarballPath, "-C", tmpDir, "package"], { stdio: "pipe" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function buildContextProfileInstructions(_workDir: string, profile: ContextProfile): string {
  switch (profile) {
    case "code-only":
      return [
        "Context profile: code-only.",
        "Evaluate the SDK from its TypeScript package API, declaration files, and JSDoc only.",
        "Do not rely on README, docs, skills, or external Tailor documentation.",
      ].join("\n");
    case "bare-types":
      return [
        "Context profile: bare-types.",
        "Solve from TypeScript type signatures alone. The installed SDK package has no JSDoc, no README, no docs, no skills, and no examples.",
        "If the API shape is not self-evident from the signatures, infer the intended usage from import paths and surrounding type structure.",
      ].join("\n");
    case "code-and-docs":
      return [
        "Context profile: code-and-docs.",
        "You may inspect the installed SDK package, including README, docs, skills, types, and examples.",
      ].join("\n");
  }
}
