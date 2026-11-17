import { describe, expect, test } from "vitest";
import * as schemaEntry from "./schema";

describe("schema entry", () => {
  test("exposes what a generated seed schema file imports", () => {
    expect(Object.keys(schemaEntry).toSorted()).toEqual(["defineSchema", "fillIdpUserPassword"]);
  });
});
