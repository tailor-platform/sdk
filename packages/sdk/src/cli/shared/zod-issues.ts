import type { z } from "zod";

type ZodIssue = z.core.$ZodIssue;

export type FlatIssue = {
  path: Array<string | number>;
  message: string;
};

/**
 * Flatten Zod issues into one entry per offending field. A failed union is
 * replaced by the issues of the branch the input came closest to matching.
 * @param issues - Issues from a failed parse
 * @returns Issues with absolute paths
 */
export function flattenZodIssues(issues: readonly ZodIssue[]): FlatIssue[] {
  return flattenAt(issues, []);
}

/**
 * Render flattened issues as an indented list, one `path: message` line each.
 * @param issues - Issues from `flattenZodIssues`
 * @returns Lines joined by newlines
 */
export function formatIssueList(issues: readonly FlatIssue[]): string {
  return issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

function flattenAt(issues: readonly ZodIssue[], prefix: readonly PropertyKey[]): FlatIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union") {
      return flattenUnion(issue, path);
    }
    return [toFlatIssue(issue, path)];
  });
}

function flattenUnion(
  union: z.core.$ZodIssueInvalidUnion,
  path: readonly PropertyKey[],
): FlatIssue[] {
  const branches: readonly (readonly ZodIssue[])[] = union.errors;
  const branchKeys = branches.map((branch) => new Set(branch.map(issueKey)));
  const shared = (branches[0] ?? []).filter((issue) =>
    branchKeys.every((keys) => keys.has(issueKey(issue))),
  );
  const sharedKeys = new Set(shared.map(issueKey));
  const [closest, runnerUp] = branches
    .map((branch) => {
      const own = branch.filter((issue) => !sharedKeys.has(issueKey(issue)));
      const depth =
        own.length === 0 ? Infinity : Math.max(...own.map((issue) => issue.path.length));
      return { own, depth };
    })
    .toSorted((a, b) => b.depth - a.depth || a.own.length - b.own.length);
  if (
    closest === undefined ||
    (runnerUp !== undefined &&
      closest.depth === runnerUp.depth &&
      closest.own.length === runnerUp.own.length)
  ) {
    return [...flattenAt(shared, path), toFlatIssue(union, path)];
  }
  return [...flattenAt(shared, path), ...flattenAt(closest.own, path)];
}

function issueKey(issue: ZodIssue): string {
  return JSON.stringify([issue.path.map(String), issue.code, issue.message]);
}

function toFlatIssue(issue: ZodIssue, path: readonly PropertyKey[]): FlatIssue {
  return {
    path: path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment)),
    message: issue.message,
  };
}
