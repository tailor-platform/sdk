import fs from "node:fs";
import path from "node:path";
import type { ContextProfile } from "../shared/helpers";

// tailor-sdk-skill keeps the installed `skills/` directory so the skill is the
// only narrative guidance; README/CHANGELOG/docs are removed to isolate it from
// the wider docs surface that `full-package` exposes.
const removableEntriesByProfile: Record<ContextProfile, readonly string[]> = {
  "types-only": ["README.md", "CHANGELOG.md", "docs", "skills"],
  "docs-only": ["skills"],
  "tailor-sdk-skill": ["README.md", "CHANGELOG.md", "docs"],
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

function readInstalledTailorSdkSkill(workDir: string): string | undefined {
  const skillPath = path.join(getInstalledSdkDir(workDir), "skills", "tailor-sdk", "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    return undefined;
  }
  return fs.readFileSync(skillPath, "utf-8");
}

export function buildContextProfileInstructions(workDir: string, profile: ContextProfile): string {
  switch (profile) {
    case "types-only":
      return [
        "Context profile: types-only.",
        "Evaluate the SDK from its TypeScript package API, declaration files, and JSDoc only.",
        "Do not rely on README, docs, skills, or external Tailor documentation.",
      ].join("\n");
    case "docs-only":
      return [
        "Context profile: docs-only.",
        "You may inspect the installed SDK README and docs directory.",
        "Do not use the tailor-sdk skill or any external Tailor documentation.",
      ].join("\n");
    case "tailor-sdk-skill": {
      const skill = readInstalledTailorSdkSkill(workDir);
      return [
        "Context profile: tailor-sdk-skill.",
        "Use the installed tailor-sdk skill as the official AI guidance for this SDK version.",
        skill ? ["## Installed tailor-sdk skill", "", skill].join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "full-package":
      return [
        "Context profile: full-package.",
        "You may inspect the installed SDK package, including README, docs, skills, types, and examples.",
      ].join("\n");
  }
}
