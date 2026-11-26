import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { onTestFinished } from "vitest";
import { runCodemods, type CodemodRunResult } from "../runner";
import { runnableCodemod } from "./codemods";

/** A temporary project directory and the files a test reads back from it. */
export type TestProject = {
  dir: string;
  /** Contents of a project file, or undefined when it does not exist. */
  read(relativePath: string): string | undefined;
  /** Project-relative paths of every file, sorted. */
  files(): string[];
};

/**
 * Create a temporary project holding `files`, removed when the test finishes.
 * @param files - File contents by project-relative path; a path ending with `/` creates a directory
 * @returns The project
 */
export function createProject(files: Record<string, string>): TestProject {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemod-project-")));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(dir, relativePath);
    if (relativePath.endsWith("/")) {
      fs.mkdirSync(file, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return {
    dir,
    read: (relativePath) => {
      const file = path.join(dir, relativePath);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined;
    },
    files: () =>
      (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[])
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
        .toSorted(),
  };
}

/**
 * Run registered codemods on a project, as `tailor upgrade` does.
 * @param ids - Registered codemod ids, in registry order
 * @param project - Project to transform
 * @param target - Project-relative directory to run them on
 * @returns The run result, with project-relative paths
 */
export async function runOnProject(
  ids: string[],
  project: TestProject,
  target = ".",
): Promise<CodemodRunResult> {
  const result = await runCodemods(ids.map(runnableCodemod), path.join(project.dir, target), false);
  const relative = (file: string) => path.relative(project.dir, file);
  return {
    ...result,
    filesModified: result.filesModified.map(relative).toSorted(),
    filesDeleted: result.filesDeleted.map(relative).toSorted(),
  };
}
