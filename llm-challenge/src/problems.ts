import { promises as fs } from "node:fs";
import path from "node:path";
import { PROBLEM_GROUPS, type Problem, type ProblemGroup, type RequestedGroup } from "./types";
import { pathExists, toPosix } from "./utils";

type ProblemMeta = {
  id: string;
  title: string;
  group?: unknown;
};

export async function discoverProblems(packageRoot: string): Promise<Problem[]> {
  const problemsRoot = path.join(packageRoot, "problems");
  const problems: Problem[] = [];

  for (const group of PROBLEM_GROUPS) {
    const groupRoot = path.join(problemsRoot, group);
    const entries = await fs.readdir(groupRoot, { withFileTypes: true });
    for (const entry of entries
      .filter((item) => item.isDirectory())
      .toSorted((left, right) => left.name.localeCompare(right.name))) {
      const problemRoot = path.join(groupRoot, entry.name);
      const metaPath = path.join(problemRoot, "meta.json");
      const promptPath = path.join(problemRoot, "prompt.md");
      const scaffoldPath = path.join(problemRoot, "scaffold");
      const verifyPath = path.join(problemRoot, "verify.json");
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as ProblemMeta;
      validateMeta(meta, metaPath);
      if (meta.id !== entry.name) {
        throw new Error(`${metaPath} id must match its directory name`);
      }
      const scaffoldStat = await fs.stat(scaffoldPath);
      if (!scaffoldStat.isDirectory()) {
        throw new Error(`${scaffoldPath} must be a directory`);
      }
      problems.push({
        id: meta.id,
        title: meta.title,
        group,
        sourcePath: toPosix(path.relative(packageRoot, problemRoot)),
        promptPath,
        scaffoldPath,
        verifyPath: (await pathExists(verifyPath)) ? verifyPath : undefined,
      });
    }
  }

  ensureUniqueIds(problems);
  return problems;
}

export function selectProblems(
  problems: Problem[],
  group: RequestedGroup,
  filters: string[],
): Problem[] {
  const byGroup =
    group === "all" ? problems : problems.filter((problem) => problem.group === group);
  if (filters.length === 0) {
    return byGroup;
  }

  const selected = new Map<string, Problem>();
  for (const filter of filters) {
    const problem = resolveProblemFilter(byGroup, filter);
    selected.set(`${problem.group}/${problem.id}`, problem);
  }
  return [...selected.values()];
}

function validateMeta(meta: ProblemMeta, metaPath: string): void {
  if (typeof meta.id !== "string" || meta.id.length === 0) {
    throw new Error(`${metaPath} must contain an id`);
  }
  if (typeof meta.title !== "string" || meta.title.length === 0) {
    throw new Error(`${metaPath} must contain a title`);
  }
  if (Object.hasOwn(meta, "group")) {
    throw new Error(`${metaPath} must derive group from its directory, not meta.json`);
  }
}

function ensureUniqueIds(problems: Problem[]): void {
  const seen = new Map<string, ProblemGroup>();
  for (const problem of problems) {
    const existing = seen.get(problem.id);
    if (existing !== undefined) {
      throw new Error(
        `Problem id must be unique across groups: ${problem.id} (${existing}, ${problem.group})`,
      );
    }
    seen.set(problem.id, problem.group);
  }
}

function resolveProblemFilter(problems: Problem[], filter: string): Problem {
  const groupMatch = /^(sdk-api|cli)\/(.+)$/.exec(filter);
  const matches =
    groupMatch === null
      ? problems.filter((problem) => problem.id === filter)
      : problems.filter(
          (problem) => problem.group === groupMatch[1] && problem.id === groupMatch[2],
        );

  if (matches.length === 0) {
    throw new Error(`Unknown problem: ${filter}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous problem id: ${filter}`);
  }
  return matches[0];
}
