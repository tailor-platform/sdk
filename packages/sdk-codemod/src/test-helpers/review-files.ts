import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { allCodemods } from "../registry";
import { runCodemods } from "../runner";

/**
 * The files the registered codemod `id` reports for review when `source` is saved at
 * `relativePath` in an otherwise empty project.
 * @param id - Registered codemod id
 * @param relativePath - Path of the file in the project
 * @param source - File contents
 * @returns The project-relative paths of the files the runner reports
 */
export async function reportedFiles(
  id: string,
  relativePath: string,
  source: string,
): Promise<string[]> {
  const codemod = allCodemods.find((entry) => entry.id === id);
  if (!codemod) throw new Error(`${id} is not registered`);

  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "review-files-"));
  try {
    const file = path.join(projectDir, relativePath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, source, "utf-8");
    const result = await runCodemods([{ codemod }], projectDir, true);
    return result.llmReviews.flatMap((review) => review.files);
  } finally {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  }
}
