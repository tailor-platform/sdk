import fs from "node:fs";
import path from "node:path";

export type ContextProfile = "types-only" | "full-package";

export const contextProfileValues = [
  "types-only",
  "full-package",
] as const satisfies readonly ContextProfile[];

export function isContextProfile(value: unknown): value is ContextProfile {
  return typeof value === "string" && (contextProfileValues as readonly string[]).includes(value);
}

// `types-only` strips README/CHANGELOG/docs/skills from the installed SDK so
// the agent must rely solely on the TypeScript surface.
// `full-package` is unfiltered.
const removableEntriesByProfile: Record<ContextProfile, readonly string[]> = {
  "types-only": ["README.md", "CHANGELOG.md", "docs", "skills"],
  "full-package": [],
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

export function buildContextProfileInstructions(_workDir: string, profile: ContextProfile): string {
  switch (profile) {
    case "types-only":
      return [
        "Context profile: types-only.",
        "Evaluate the SDK from its TypeScript package API, declaration files, and JSDoc only.",
        "Do not rely on README, docs, skills, or external Tailor documentation.",
      ].join("\n");
    case "full-package":
      return [
        "Context profile: full-package.",
        "You may inspect the installed SDK package, including README, docs, skills, types, and examples.",
      ].join("\n");
  }
}
