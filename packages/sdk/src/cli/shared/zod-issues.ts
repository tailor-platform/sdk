import type { z } from "zod";

type ZodIssue = z.core.$ZodIssue;

export type FlatIssue = {
  path: Array<string | number>;
  message: string;
};

/**
 * Flatten Zod issues into one entry per offending field. A failed union is
 * replaced by the issues of the branch the input came closest to matching,
 * and an invalid record key by the issues of the key schema.
 * @param issues - Issues from a failed parse
 * @param prefix - Path of the parsed value, prepended to every issue path
 * @returns Issues with absolute paths
 */
export function flattenZodIssues(
  issues: readonly ZodIssue[],
  prefix: readonly PropertyKey[] = [],
): FlatIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union") {
      return flattenUnion(issue, path);
    }
    if (issue.code === "invalid_key") {
      return flattenZodIssues(issue.issues, path);
    }
    return [toFlatIssue(issue, path)];
  });
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
  const ranked = branches
    .map((branch) => {
      const own = branch.filter((issue) => !sharedKeys.has(issueKey(issue)));
      const depth =
        own.length === 0 ? Infinity : Math.max(...own.map((issue) => issue.path.length));
      return { own, depth };
    })
    .toSorted((a, b) => b.depth - a.depth || a.own.length - b.own.length);
  const [closest, runnerUp] = ranked;
  if (
    closest === undefined ||
    (closest.own.length > 0 &&
      runnerUp !== undefined &&
      closest.depth === runnerUp.depth &&
      closest.own.length === runnerUp.own.length)
  ) {
    return [
      ...flattenZodIssues(shared, path),
      { ...toFlatIssue(union, path), message: tiedUnionMessage(union, ranked) },
    ];
  }
  return [...flattenZodIssues(shared, path), ...flattenZodIssues(closest.own, path)];
}

// zod's own message for a union; any other message was written for the field.
const DEFAULT_UNION_MESSAGE = "Invalid input";

function tiedUnionMessage(
  union: z.core.$ZodIssueInvalidUnion,
  branches: readonly { own: readonly ZodIssue[] }[],
): string {
  if (union.message !== DEFAULT_UNION_MESSAGE) {
    return union.message;
  }
  const expected = new Set<string>();
  for (const issue of branches.flatMap((branch) => branch.own)) {
    if (issue.path.length > 0) {
      return union.message;
    }
    if (issue.code === "invalid_type") {
      expected.add(issue.expected);
    } else if (issue.code === "invalid_value") {
      for (const value of issue.values) {
        expected.add(typeof value === "string" ? JSON.stringify(value) : String(value));
      }
    } else {
      return union.message;
    }
  }
  return expected.size === 0
    ? union.message
    : `${union.message}: expected ${[...expected].join(" | ")}`;
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
