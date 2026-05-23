import { promises as fs } from "node:fs";
import path from "node:path";
import { runCommand } from "./process";

const NO_DOCS_REMOVE_ENTRIES = [
  "README.md",
  "CHANGELOG.md",
  "docs",
  "examples",
  "agent-skills",
  "skills",
];

export async function createNoDocsTarball(
  fullTarballPath: string,
  outputTarballPath: string,
  tempRoot: string,
): Promise<void> {
  const unpackRoot = path.join(tempRoot, "no-docs-unpack");
  await fs.rm(unpackRoot, { recursive: true, force: true });
  await fs.mkdir(unpackRoot, { recursive: true });
  await runCommand("tar", ["-xzf", fullTarballPath, "-C", unpackRoot]);
  const packageDir = path.join(unpackRoot, "package");
  await applyNoDocsProfile(packageDir);
  await fs.rm(outputTarballPath, { force: true });
  await runCommand("tar", ["-czf", outputTarballPath, "-C", unpackRoot, "package"]);
}

export async function applyNoDocsProfile(packageDir: string): Promise<void> {
  for (const entry of NO_DOCS_REMOVE_ENTRIES) {
    await fs.rm(path.join(packageDir, entry), { recursive: true, force: true });
  }

  for await (const filePath of walkFiles(packageDir)) {
    if (filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts")) {
      const original = await fs.readFile(filePath, "utf8");
      const stripped = stripDeclarationJsDoc(original);
      if (stripped !== original) {
        await fs.writeFile(filePath, stripped);
      }
    }
  }
}

export function stripDeclarationJsDoc(contents: string): string {
  return contents.replace(/\/\*\*[\s\S]*?\*\//g, "");
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
