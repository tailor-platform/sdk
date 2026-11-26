import { describe, expect, test } from "vitest";
import { parseUiManifest } from "./manifest";

describe("parseUiManifest", () => {
  test("accepts a module plugin", () => {
    expect(
      parseUiManifest({ id: "tailordb-erd", title: "ERD", kind: "module", entry: "./dist/ui.js" }),
    ).toEqual({ id: "tailordb-erd", title: "ERD", kind: "module", entry: "./dist/ui.js" });
  });

  test("rejects a process plugin as not supported yet", () => {
    expect(() =>
      parseUiManifest({ id: "foo", title: "Foo", kind: "process", command: "tailor-foo" }),
    ).toThrow(/kind "process" is not supported/);
  });

  test.each(["", "Has Space", "../up", "a/b", "api", "plugins", "assets"])(
    "rejects the id %j",
    (id) => {
      expect(() => parseUiManifest({ id, title: "X", kind: "module", entry: "./x.js" })).toThrow(
        /id/,
      );
    },
  );

  test("rejects a module plugin without entry", () => {
    expect(() => parseUiManifest({ id: "foo", title: "Foo", kind: "module" })).toThrow(/entry/);
  });
});
