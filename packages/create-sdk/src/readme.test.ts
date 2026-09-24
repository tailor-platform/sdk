import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { templateHints } from "./context";

const packageDir = resolve(import.meta.dirname, "..");

const shippedTemplates = readdirSync(resolve(packageDir, "templates"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const readme = readFileSync(resolve(packageDir, "README.md"), "utf-8");
const availableTemplatesSection =
  readme.split(/^## Available Templates$/m)[1]?.split(/^## /m)[0] ?? "";

const tableTemplates = [...availableTemplatesSection.matchAll(/^\| `([^`]+)` +\|/gm)]
  .map(([, name]) => name)
  .toSorted();

const sectionTemplates = [...availableTemplatesSection.matchAll(/^### (\S+)$/gm)]
  .map(([, name]) => name)
  .toSorted();

describe("create-sdk template list", () => {
  test("README's Available Templates table lists exactly the templates in templates/", () => {
    expect(tableTemplates).toEqual(shippedTemplates);
  });

  test("README has exactly one section per template in templates/", () => {
    expect(sectionTemplates).toEqual(shippedTemplates);
  });

  test("every template in templates/ has a prompt hint and no hint points to a missing template", () => {
    expect(Object.keys(templateHints).toSorted()).toEqual(shippedTemplates);
  });
});
