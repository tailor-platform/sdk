import { describe, expect, test } from "vitest";
import { onlyTab } from "./only-tab";

const TABS = [
  { id: "tailordb-erd", title: "ERD", state: "no-ui-support" as const },
  { id: "function-run", title: "Function run", state: "no-ui-support" as const },
];

describe("onlyTab", () => {
  test("keeps every tab when no tab is asked for", () => {
    expect(onlyTab(TABS, undefined)).toEqual(TABS);
  });

  test("keeps just the tab with the given id", () => {
    expect(onlyTab(TABS, "function-run")).toEqual([TABS[1]]);
  });

  test("names the tabs that exist when the id matches none", () => {
    expect(() => onlyTab(TABS, "seed")).toThrow(
      'No tab "seed" (available: tailordb-erd, function-run)',
    );
  });
});
