import { describe, expect, test } from "vitest";
import {
  compareToBase,
  extractBenchSources,
  parseBenchOutput,
  renderChanges,
  toOctocovMetrics,
  type BenchResult,
} from "./report";

const cleanOutput = `🏌️  tailordb-basic
⛳ Result: 2314 instantiations
🎯 Baseline: 2314 instantiations
📊 Delta: 0.00%

🏌️  resolver-basic
⛳ Result: 1020 instantiations
🎯 Baseline: 1020 instantiations
📊 Delta: 0.00%
`;

const regressionOutput = `🏌️  tailordb-basic
⛳ Result: 2314 instantiations
🎯 Baseline: 1000 instantiations
📈 'tailordb-basic' exceeded baseline by 131.40% (threshold is 20%).

🏌️  resolver-basic
⛳ Result: 1020 instantiations
🎯 Baseline: 1000 instantiations
📊 Delta: +2.00%

❌ 'tailordb-basic' exceeded baseline by 131.40% (threshold is 20%).
`;

const improvementOutput = `🏌️  tailordb-basic
⛳ Result: 2314 instantiations
🎯 Baseline: 3000 instantiations
📉 tailordb-basic was under baseline by 22.87%! Consider setting a new baseline.
`;

const benchSource = `import { bench } from "@ark/attest";

bench("tailordb-basic", () => {
  return db.table("Type0", {
    stringField: db.string(),
  });
}).types([2314, "instantiations"]);

bench("resolver-basic", () => {
  return createResolver({ name: "resolver0" });
}).types([1020, "instantiations"]);
`;

describe("parseBenchOutput", () => {
  test("reads the measured and baseline instantiations of each bench", () => {
    expect(parseBenchOutput(cleanOutput)).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 2314 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1020 },
    ]);
  });

  test("keeps the numbers when the delta line is replaced by an exceeded-threshold message", () => {
    expect(parseBenchOutput(regressionOutput)).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 1000 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1000 },
    ]);
  });

  test("keeps the numbers when the delta line is replaced by an under-baseline message", () => {
    expect(parseBenchOutput(improvementOutput)).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 3000 },
    ]);
  });

  test("returns no results for output without benches", () => {
    expect(parseBenchOutput("error: something failed\n")).toEqual([]);
  });
});

describe("extractBenchSources", () => {
  test("maps each bench name to the body of its callback", () => {
    expect(extractBenchSources(benchSource)).toEqual({
      "tailordb-basic": `return db.table("Type0", {
  stringField: db.string(),
});`,
      "resolver-basic": `return createResolver({ name: "resolver0" });`,
    });
  });

  test("ignores calls other than bench", () => {
    expect(extractBenchSources(`other("x", () => { return 1; });`)).toEqual({});
  });
});

describe("compareToBase", () => {
  const results: BenchResult[] = [
    { name: "tailordb-basic", instantiations: 2314, baseline: 2314 },
    { name: "resolver-basic", instantiations: 1020, baseline: 1020 },
  ];

  test("takes each baseline from the instantiations measured on the base", () => {
    const base: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2000, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1000, baseline: 1000 },
    ];
    expect(compareToBase(results, base)).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1000 },
    ]);
  });

  test("treats a bench missing on the base as unchanged", () => {
    const base: BenchResult[] = [{ name: "tailordb-basic", instantiations: 2000, baseline: 2000 }];
    expect(compareToBase(results, base)).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1020 },
    ]);
  });

  test("treats a base where every case measured zero as not measured", () => {
    const base: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 0, baseline: 0 },
      { name: "resolver-basic", instantiations: 0, baseline: 0 },
    ];
    expect(compareToBase(results, base)).toEqual(results);
  });

  test("keeps a zero measured on the base for one case while other cases measured", () => {
    const base: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 0, baseline: 0 },
      { name: "resolver-basic", instantiations: 1000, baseline: 1000 },
    ];
    expect(compareToBase(results, base)).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 0 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1000 },
    ]);
  });
});

describe("renderChanges", () => {
  const sources = {
    "tailordb-basic": `return db.table("Type0", {});`,
    "resolver-basic": `return createResolver({});`,
  };

  test("renders nothing when every bench matches its baseline", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2314 },
    ];
    expect(renderChanges(results, sources)).toBe("");
  });

  test("marks an increase with the base, result, percentage and count", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
    ];
    expect(renderChanges(results, sources)).toContain(
      "| 🔺 | tailordb-basic | 2000 | 2314 | **+15.70%** (+314) |",
    );
  });

  test("headlines how many cases changed", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1220, baseline: 1020 },
    ];
    expect(renderChanges(results, sources)).toContain("### Type instantiations changed in 2 cases");
  });

  test("headlines a single changed case in the singular", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
    ];
    expect(renderChanges(results, sources)).toContain(
      "### Type instantiations changed in 1 case\n",
    );
  });

  test("lists the case with the largest relative change first", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2100, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1500, baseline: 1000 },
    ];
    const rendered = renderChanges(results, sources);
    expect(rendered.indexOf("| resolver-basic |")).toBeLessThan(
      rendered.indexOf("| tailordb-basic |"),
    );
  });

  test("shows the measured code of a changed bench, expanded", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
    ];
    expect(renderChanges(results, sources)).toContain(
      '<details open><summary>tailordb-basic</summary>\n\n```ts\nreturn db.table("Type0", {});\n```',
    );
  });

  test("omits benches that did not change", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1020 },
    ];
    expect(renderChanges(results, sources)).not.toContain("resolver-basic");
  });

  test("shows an increase from zero without a percentage", () => {
    const results: BenchResult[] = [{ name: "tailordb-basic", instantiations: 100, baseline: 0 }];
    expect(renderChanges(results, sources)).toContain(
      "| 🔺 | tailordb-basic | 0 | 100 | **n/a** (+100) |",
    );
  });

  test("lists an increase from zero before percentage changes", () => {
    const results: BenchResult[] = [
      { name: "resolver-basic", instantiations: 5000, baseline: 1000 },
      { name: "tailordb-basic", instantiations: 100, baseline: 0 },
    ];
    const rendered = renderChanges(results, sources);
    expect(rendered.indexOf("| tailordb-basic |")).toBeLessThan(
      rendered.indexOf("| resolver-basic |"),
    );
  });

  test("marks a decrease with a minus sign", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 1500, baseline: 2000 },
    ];
    expect(renderChanges(results, sources)).toContain(
      "| 🔻 | tailordb-basic | 2000 | 1500 | **-25.00%** (-500) |",
    );
  });
});

describe("toOctocovMetrics", () => {
  test("reports each bench's measured instantiations as a custom metric", () => {
    const results: BenchResult[] = [
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
    ];
    expect(toOctocovMetrics(results)).toEqual({
      key: "attest-type-performance",
      name: "Type Performance (attest instantiations)",
      metrics: [{ key: "tailordb-basic", name: "tailordb-basic", value: 2314, unit: "" }],
    });
  });
});
