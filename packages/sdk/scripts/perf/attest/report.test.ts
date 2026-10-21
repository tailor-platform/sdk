import { describe, expect, test } from "vitest";
import {
  compareToBase,
  extractBaselines,
  extractBenchSources,
  renderChanges,
  toOctocovMetrics,
  type BenchResult,
} from "./report";

describe("extractBaselines", () => {
  test("maps each bench name to the count attest recorded in its types snapshot", () => {
    const source = `
bench("tailordb-basic", () => db.table("Type0", {})).types([2314, "instantiations"]);
bench("resolver-basic", () => createResolver({})).types([1020,"instantiations"]);
`;
    expect(extractBaselines(source)).toEqual({ "tailordb-basic": 2314, "resolver-basic": 1020 });
  });

  test("skips a bench whose types snapshot is not recorded yet", () => {
    expect(extractBaselines(`bench("new", () => 1).types();`)).toEqual({});
  });

  test("ignores a call that is not a bench", () => {
    expect(extractBaselines(`other("x", () => 1).types([1, "instantiations"]);`)).toEqual({});
  });
});

describe("extractBenchSources", () => {
  test("maps each bench name to the body of its callback", () => {
    const source = `
bench("tailordb-basic", () => {
  return db.table("Type0", {
    stringField: db.string(),
  });
}).types([1, "instantiations"]);

bench("resolver-basic", () => {
  return createResolver({ name: "resolver0" });
}).types([2, "instantiations"]);
`;
    expect(extractBenchSources(source)).toEqual({
      "tailordb-basic": `return db.table("Type0", {
  stringField: db.string(),
});`,
      "resolver-basic": `return createResolver({ name: "resolver0" });`,
    });
  });

  test("uses the expression itself for a callback without a block", () => {
    expect(extractBenchSources(`bench("keyword", () => type("string")).types();`)).toEqual({
      keyword: `type("string")`,
    });
  });

  test("ignores calls other than bench", () => {
    expect(extractBenchSources(`other("x", () => { return 1; });`)).toEqual({});
  });
});

describe("compareToBase", () => {
  const current = { "tailordb-basic": 2314, "resolver-basic": 1020 };

  test("takes each baseline from the count measured on the base", () => {
    expect(compareToBase(current, { "tailordb-basic": 2000, "resolver-basic": 1000 })).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1000 },
    ]);
  });

  test("treats a case missing on the base as unchanged", () => {
    expect(compareToBase(current, { "tailordb-basic": 2000 })).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 2000 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1020 },
    ]);
  });

  test("treats a base where every case measured zero as not measured", () => {
    expect(compareToBase(current, { "tailordb-basic": 0, "resolver-basic": 0 })).toEqual([
      { name: "tailordb-basic", instantiations: 2314, baseline: 2314 },
      { name: "resolver-basic", instantiations: 1020, baseline: 1020 },
    ]);
  });

  test("keeps a zero measured on the base for one case while other cases measured", () => {
    expect(compareToBase(current, { "tailordb-basic": 0, "resolver-basic": 1000 })).toEqual([
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
  const changed = (overrides: Partial<BenchResult> = {}): BenchResult => ({
    name: "tailordb-basic",
    instantiations: 2314,
    baseline: 2000,
    ...overrides,
  });

  test("renders nothing when every case matches its baseline", () => {
    expect(renderChanges([changed({ baseline: 2314 })], sources)).toBe("");
  });

  test("marks an increase with the base, result, percentage and count", () => {
    expect(renderChanges([changed()], sources)).toContain(
      "| 🔺 | tailordb-basic | 2000 | 2314 | **+15.70%** (+314) |",
    );
  });

  test("marks a decrease with a minus sign", () => {
    expect(renderChanges([changed({ instantiations: 1500 })], sources)).toContain(
      "| 🔻 | tailordb-basic | 2000 | 1500 | **-25.00%** (-500) |",
    );
  });

  test("shows an increase from zero without a percentage", () => {
    expect(renderChanges([changed({ instantiations: 100, baseline: 0 })], sources)).toContain(
      "| 🔺 | tailordb-basic | 0 | 100 | **n/a** (+100) |",
    );
  });

  test("headlines how many cases changed", () => {
    const results = [
      changed(),
      changed({ name: "resolver-basic", instantiations: 1220, baseline: 1020 }),
    ];
    expect(renderChanges(results, sources)).toContain("### Type instantiations changed in 2 cases");
  });

  test("headlines a single changed case in the singular", () => {
    expect(renderChanges([changed()], sources)).toContain(
      "### Type instantiations changed in 1 case\n",
    );
  });

  test("lists the case with the largest relative change first", () => {
    const results = [
      changed({ instantiations: 2100 }),
      changed({ name: "resolver-basic", instantiations: 1500, baseline: 1000 }),
    ];
    const rendered = renderChanges(results, sources);
    expect(rendered.indexOf("| resolver-basic |")).toBeLessThan(
      rendered.indexOf("| tailordb-basic |"),
    );
  });

  test("lists an increase from zero before percentage changes", () => {
    const results = [
      changed({ name: "resolver-basic", instantiations: 5000, baseline: 1000 }),
      changed({ instantiations: 100, baseline: 0 }),
    ];
    const rendered = renderChanges(results, sources);
    expect(rendered.indexOf("| tailordb-basic |")).toBeLessThan(
      rendered.indexOf("| resolver-basic |"),
    );
  });

  test("shows the measured code of a changed case, expanded", () => {
    expect(renderChanges([changed()], sources)).toContain(
      '<details open><summary>tailordb-basic</summary>\n\n```ts\nreturn db.table("Type0", {});\n```',
    );
  });

  test("omits cases that did not change", () => {
    const results = [
      changed(),
      changed({ name: "resolver-basic", instantiations: 1020, baseline: 1020 }),
    ];
    expect(renderChanges(results, sources)).not.toContain("resolver-basic");
  });
});

describe("toOctocovMetrics", () => {
  test("reports each case's measured count as a custom metric", () => {
    expect(toOctocovMetrics({ "tailordb-basic": 2314 })).toEqual({
      key: "type-performance",
      name: "Type Performance (instantiations)",
      metrics: [{ key: "tailordb-basic", name: "tailordb-basic", value: 2314, unit: "" }],
    });
  });
});
