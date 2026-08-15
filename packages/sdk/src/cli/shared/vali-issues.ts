import type * as v from "valibot";

/**
 * Collects leaf issue messages from a Valibot safeParse failure, descending into
 * nested `issues` (as produced by `v.union`/`v.variant` wrapping a deeper check).
 * @param issues - The issues array from a failed `v.safeParse` result
 * @returns Leaf messages joined with "; "
 */
export function formatValiIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  const messages: string[] = [];
  const collect = (list: readonly v.BaseIssue<unknown>[]): void => {
    // A failing union reports one issue per branch, most of which are just "this value
    // isn't a literal X" noise from branches that were never a real candidate for this
    // input's shape. Drop those literal-type mismatches when at least one sibling issue
    // is more specific (e.g. a `check` failure), so the informative message isn't buried.
    const hasSpecificIssue = list.some((issue) => issue.type !== "literal");
    for (const issue of list) {
      if (hasSpecificIssue && issue.type === "literal") {
        continue;
      }
      if ("issues" in issue && Array.isArray(issue.issues)) {
        collect(issue.issues as v.BaseIssue<unknown>[]);
      } else {
        messages.push(issue.message);
      }
    }
  };
  collect(issues);
  return messages.join("; ");
}
