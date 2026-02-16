import fs from "node:fs";
import path from "node:path";

export type ProblemMeta = {
  id: string;
  name: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  scoring: {
    generate: number;
    typecheck: number;
    tests: number;
  };
  files: {
    implement: string[];
    scaffold: string[];
  };
};

export function loadMeta(problemDir: string): ProblemMeta {
  const metaPath = path.join(problemDir, "meta.json");
  const content = fs.readFileSync(metaPath, "utf-8");
  return JSON.parse(content) as ProblemMeta;
}

/**
 * List all problem directories sorted by ID.
 */
export function listProblems(baseDir: string): string[] {
  const problemsDir = path.join(baseDir, "problems");
  if (!fs.existsSync(problemsDir)) {
    return [];
  }
  return fs
    .readdirSync(problemsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{3}-/.test(d.name))
    .map((d) => d.name)
    .sort();
}

/**
 * Copy directory recursively.
 */
export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
