import { readFileSync, readdirSync } from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";

const cliDir = path.join(import.meta.dirname, "..");
const docPath = path.join(import.meta.dirname, "../../../../../docs/telemetry.md");

/**
 * Every span name the CLI sources open a span with.
 * @returns Span names found in the CLI sources
 */
function emittedSpanNames(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Fixture trees are written by sibling suites while this one walks.
      if (entry.name.startsWith("__test") || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      // `phase()` and `step()` in apply-phases.ts open spans too, so all spellings count.
      for (const match of readFileSync(full, "utf8").matchAll(
        /(?:withSpan|phase|step)\("([^"]+)"/g,
      )) {
        names.add(match[1]!);
      }
    }
  };
  walk(cliDir);
  // The doc draws the deploy tree only; `generate.*` has no documented tree yet.
  return new Set([...names].filter((name) => !name.startsWith("generate")));
}

/**
 * Span names drawn in the doc's `deploy` span tree.
 * @returns Span names listed in the documented tree
 */
function documentedSpanNames(): Set<string> {
  const doc = readFileSync(docPath, "utf8");
  const tree = doc.slice(
    doc.indexOf("```\ndeploy\n") + 4,
    doc.indexOf("```", doc.indexOf("```\ndeploy\n") + 4),
  );
  const names = new Set<string>();
  for (const line of tree.split("\n")) {
    const name = line.replace(/^[│├└─\s]+/u, "").trim();
    if (name) names.add(name);
  }
  return names;
}

describe("documented span tree", () => {
  // The tree drifted from the source once already: it listed per-service apply
  // spans that were never emitted. Nothing else keeps the two in agreement.
  test("names exactly the spans the CLI emits", () => {
    const emitted = emittedSpanNames();
    const documented = documentedSpanNames();

    // Guard against a walk that silently found nothing.
    expect(emitted.has("apply.tailorDB.createUpdate")).toBe(true);
    expect(emitted.size).toBeGreaterThan(20);

    expect([...documented].toSorted()).toEqual([...emitted].toSorted());
  });
});
