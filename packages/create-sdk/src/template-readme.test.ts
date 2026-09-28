import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const templatesDir = resolve(import.meta.dirname, "..", "templates");

const templateNames = readdirSync(templatesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const readTemplateReadme = (template: string) => {
  const path = join(templatesDir, template, "README.md");
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8").replace(/^```[\s\S]*?^```/gm, "");
};

const readTemplateSource = (dir: string): string =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules")
    .map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return readTemplateSource(path);
      return entry.name.endsWith(".ts") ? readFileSync(path, "utf-8") : "";
    })
    .join("\n");

const mentionedFunctionNames = (readme: string) => [
  ...new Set(
    [...readme.matchAll(/`\.?([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)(?:\(\))?`/g)].map(
      ([, name]) => name,
    ),
  ),
];

const executorReadme = readTemplateReadme("executor");
const executorSource = readTemplateSource(join(templatesDir, "executor", "src"));

describe("template READMEs", () => {
  test.each(templateNames)(
    "every function name the %s README mentions is used in that template's source",
    (template) => {
      const source = readTemplateSource(join(templatesDir, template));
      const missing = mentionedFunctionNames(readTemplateReadme(template)).filter(
        (name) => !new RegExp(`\\b${name}\\b`).test(source),
      );
      expect(missing).toEqual([]);
    },
  );

  test("the executor README lists exactly the operation kinds the executor template uses", () => {
    const listedKinds = [
      ...(executorReadme.split(/^## Operation Kinds$/m)[1]?.split(/^## /m)[0] ?? "").matchAll(
        /^- `([a-z]+)`/gm,
      ),
    ].map(([, kind]) => kind);
    const usedKinds = [
      ...new Set([...executorSource.matchAll(/kind: "([a-z]+)"/g)].map(([, kind]) => kind)),
    ];
    expect(listedKinds.toSorted()).toEqual(usedKinds.toSorted());
  });

  test("the executor README lists every trigger the executor template uses", () => {
    const usedTriggers = new Set(
      [...executorSource.matchAll(/\b([a-z][a-zA-Z]*Trigger)\b/g)].map(([, name]) => name),
    );
    const unlisted = [...usedTriggers].filter((name) => !executorReadme.includes(`\`${name}\``));
    expect(unlisted).toEqual([]);
  });
});
