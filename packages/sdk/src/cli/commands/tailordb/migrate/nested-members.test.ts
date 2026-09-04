import { describe, expect, test } from "vitest";
import { collectNestedMemberChanges } from "./nested-members";
import type { SnapshotFieldConfig } from "./snapshot-types";

const str: SnapshotFieldConfig = { type: "string", required: false };
const nested = (fields: Record<string, SnapshotFieldConfig>): SnapshotFieldConfig => ({
  type: "nested",
  required: false,
  fields,
});

describe("collectNestedMemberChanges", () => {
  test("returns nothing for identical nested structures", () => {
    expect(collectNestedMemberChanges(nested({ zip: str }), nested({ zip: str }))).toEqual([]);
  });

  test("reports removed, added, and modified members at one level", () => {
    const changes = collectNestedMemberChanges(
      nested({ zip: str, city: str }),
      nested({ zipCode: str, city: { type: "string", required: true } }),
    );

    expect(changes).toEqual([
      { kind: "removed", path: ["zip"], before: str },
      { kind: "added", path: ["zipCode"], after: str },
      { kind: "modified", path: ["city"], before: str, after: { type: "string", required: true } },
    ]);
  });

  test("recurses into members present on both sides without duplicating the ancestor", () => {
    const changes = collectNestedMemberChanges(
      nested({ geo: nested({ lat: str, lng: str }) }),
      nested({ geo: nested({ lat: str }) }),
    );

    expect(changes).toEqual([{ kind: "removed", path: ["geo", "lng"], before: str }]);
  });

  test("reports an ancestor whose own configuration changed alongside member changes", () => {
    const changes = collectNestedMemberChanges(
      nested({ geo: nested({ lat: str }) }),
      nested({ geo: { ...nested({}), description: "Coordinates" } }),
    );

    expect(changes.map((c) => [c.kind, c.path.join(".")])).toEqual([
      ["removed", "geo.lat"],
      ["modified", "geo"],
    ]);
  });

  test("collapses a removed or added subtree into a single entry", () => {
    const changes = collectNestedMemberChanges(
      nested({ geo: nested({ lat: str, lng: str }) }),
      nested({ office: nested({ floor: str }) }),
    );

    expect(changes.map((c) => [c.kind, c.path.join(".")])).toEqual([
      ["removed", "geo"],
      ["added", "office"],
    ]);
  });

  test("detects removal of a member named like an inherited object property", () => {
    const changes = collectNestedMemberChanges(
      nested({ constructor: str, toString: str }),
      nested({ toString: str }),
    );

    expect(changes).toEqual([{ kind: "removed", path: ["constructor"], before: str }]);
  });

  test("ignores enum value order when deciding whether a member is modified", () => {
    const status = (values: string[]): SnapshotFieldConfig => ({
      type: "enum",
      required: false,
      allowedValues: values.map((value) => ({ value })),
    });
    const changes = collectNestedMemberChanges(
      nested({ status: status(["A", "B"]), zip: str }),
      nested({ status: status(["B", "A"]) }),
    );

    expect(changes).toEqual([{ kind: "removed", path: ["zip"], before: str }]);
  });

  test("treats a field without nested members as having none", () => {
    expect(collectNestedMemberChanges(str, nested({ zip: str }))).toEqual([
      { kind: "added", path: ["zip"], after: str },
    ]);
  });
});
