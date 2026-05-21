import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ContextProfile = "code-only" | "code-and-docs";

export const contextProfileValues = [
  "code-only",
  "code-and-docs",
] as const satisfies readonly ContextProfile[];

export function isContextProfile(value: unknown): value is ContextProfile {
  return typeof value === "string" && (contextProfileValues as readonly string[]).includes(value);
}

// `code-only` strips README/CHANGELOG/docs/skills from the installed SDK so
// the agent must rely solely on the TypeScript surface.
// `code-and-docs` is unfiltered.
const removableEntriesByProfile: Record<ContextProfile, readonly string[]> = {
  "code-only": ["README.md", "CHANGELOG.md", "docs", "skills"],
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
  if (entries.length === 0) {
    return;
  }
  const sdkDir = getInstalledSdkDir(workDir);
  if (!isLocalInstalledPackage(workDir, sdkDir)) {
    return;
  }
  for (const entry of entries) {
    fs.rmSync(path.join(sdkDir, entry), { recursive: true, force: true });
  }
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
  if (entries.length === 0 || !fs.existsSync(tarballPath)) {
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-sdk-filter-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", tmpDir], { stdio: "pipe" });
    const pkgDir = path.join(tmpDir, "package");
    for (const entry of entries) {
      fs.rmSync(path.join(pkgDir, entry), { recursive: true, force: true });
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
    case "code-and-docs":
      return [
        "Context profile: code-and-docs.",
        "You may inspect the installed SDK package, including README, docs, skills, types, and examples.",
      ].join("\n");
  }
}
