import { describe, expect, it } from "vitest";
import { parseTypes } from "@/parser/service/tailordb";
import { toSchemaOutputs } from "@/utils/test/internal";
import * as basicFeatures from "./tailordb-basic";
import * as enumFeatures from "./tailordb-enum";
import * as hooksFeatures from "./tailordb-hooks";
import * as objectFeatures from "./tailordb-object";
import * as optionalFeatures from "./tailordb-optional";
import * as relationFeatures from "./tailordb-relation";
import * as validateFeatures from "./tailordb-validate";

const featureModules = {
  "tailordb-basic": basicFeatures,
  "tailordb-enum": enumFeatures,
  "tailordb-hooks": hooksFeatures,
  "tailordb-object": objectFeatures,
  "tailordb-optional": optionalFeatures,
  "tailordb-relation": relationFeatures,
  "tailordb-validate": validateFeatures,
};

describe("perf feature scripts pass through parseTypes", () => {
  for (const [name, mod] of Object.entries(featureModules)) {
    it(`${name}: every exported type parses`, () => {
      const types = Object.values(mod) as { name: string }[];
      const rawTypes = toSchemaOutputs(Object.fromEntries(types.map((t) => [t.name, t])));
      expect(() => parseTypes(rawTypes, "perf", {})).not.toThrow();
    });
  }
});
