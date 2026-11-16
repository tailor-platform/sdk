import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { allCodemods } from "../registry";
import { codemodFileMatcher, runCodemods } from "../runner";
import type { CodemodPackage, LlmReviewFinding } from "../types";

const CODEMODS_DIR = path.resolve(__dirname, "../../codemods");

/**
 * The TypeScript source of a transform the registry names by its built `scriptPath`.
 * @param scriptPath - A registry entry's `scriptPath`
 * @returns The absolute path of the transform's source
 */
export function transformSourcePath(scriptPath: string): string {
  return path.join(CODEMODS_DIR, scriptPath.replace(/\.js$/, ".ts"));
}

/**
 * The registered codemod `id` with its transform's source, as `runCodemods` takes it.
 * @param id - Registered codemod id
 * @returns The codemod and its transform's path
 */
export function runnableCodemod(id: string): { codemod: CodemodPackage; scriptPath: string } {
  const codemod = allCodemods.find((entry) => entry.id === id);
  if (!codemod?.scriptPath) throw new Error(`${id} is not registered with a script`);
  return { codemod, scriptPath: transformSourcePath(codemod.scriptPath) };
}

/**
 * Runs the codemod `id` on `projectDir` with `source` saved at `relativePath`, as
 * `tailor upgrade` does, so its review detectors receive the content the runner passes them.
 * @param id - Registered codemod id
 * @param projectDir - Absolute project directory, which may hold other files the codemod reads
 * @param source - File contents
 * @param relativePath - Path of the file in the project
 * @returns The rewritten contents, or null when unchanged, and the runner's review findings for the file
 */
export async function reviewInProject(
  id: string,
  projectDir: string,
  source: string,
  relativePath: string,
): Promise<{ transformed: string | null; findings: LlmReviewFinding[] }> {
  const entry = runnableCodemod(id);
  if (!entry.codemod.prompt) throw new Error(`${id} has no prompt, so the runner reviews nothing`);
  if (!codemodFileMatcher(entry.codemod)(relativePath)) {
    throw new Error(`${id} does not run on ${relativePath}`);
  }
  const file = path.join(projectDir, relativePath);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, source, "utf-8");
  const result = await runCodemods([entry], projectDir, false);
  const output = await fs.promises.readFile(file, "utf-8");
  return {
    transformed: output === source ? null : output,
    findings: result.llmReviews
      .flatMap((review) => review.findings ?? [])
      .filter((finding) => finding.file === relativePath),
  };
}

/**
 * Runs the codemod `id` on `source` saved at `relativePath` in a temporary project, as
 * `tailor upgrade` does, so its review detectors receive the content the runner passes them.
 * @param id - Registered codemod id
 * @param source - File contents
 * @param relativePath - Path of the file in the project
 * @returns The rewritten contents, or null when unchanged, and the runner's review findings
 */
export async function reviewThroughRunner(
  id: string,
  source: string,
  relativePath = "tailor.config.ts",
): Promise<{ transformed: string | null; findings: LlmReviewFinding[] }> {
  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codemod-review-"));
  try {
    return await reviewInProject(id, projectDir, source, relativePath);
  } finally {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  }
}
