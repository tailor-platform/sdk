import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  fingerprintOf,
  renderedTemplates,
  renderedTemplatesFingerprint,
} from "./template-fingerprint";
import {
  readTemplateVersionState,
  resolvePendingTemplateVersion,
  templateVersionDrift,
} from "./template-version";

const result = (content: string, generatedIds: string[] = ["tailor-plan"]) => ({
  name: "branch",
  content,
  generatedIds,
});

describe("fingerprintOf", () => {
  test("is stable for the same rendered templates", () => {
    expect(fingerprintOf([result("a")])).toBe(fingerprintOf([result("a")]));
  });

  test("changes when a rendered workflow changes", () => {
    expect(fingerprintOf([result("a")])).not.toBe(fingerprintOf([result("b")]));
  });

  test("changes when the managed ids change even if the content does not", () => {
    expect(fingerprintOf([result("a", ["tailor-plan"])])).not.toBe(
      fingerprintOf([result("a", ["tailor-plan", "tailor-deploy"])]),
    );
  });
});

describe("renderedTemplates", () => {
  test("renders every workflow template in the package", () => {
    const templates = fs
      .readdirSync(import.meta.dirname)
      .filter((file) => file.endsWith(".workflow.yml"))
      .map((file) => file.slice(0, -".workflow.yml".length));

    expect(new Set(renderedTemplates().map((rendered) => rendered.template))).toEqual(
      new Set(templates),
    );
  });

  test("names each render uniquely", () => {
    const names = renderedTemplates().map((rendered) => rendered.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test.each(renderedTemplates())("$name fills every placeholder and parses", ({ content }) => {
    expect(content).not.toMatch(/__[A-Z_]+__/);
    expect(() => parse(content)).not.toThrow();
  });
});

describe("template version", () => {
  const templatesPath = path.join(import.meta.dirname, "templates.ts");
  const driftOf = (source: string) =>
    templateVersionDrift({
      ...readTemplateVersionState(source),
      currentHash: renderedTemplatesFingerprint(),
    });

  test("marks a template change as pending until the next release records it", () => {
    expect(driftOf(fs.readFileSync(templatesPath, "utf-8"))).toBeUndefined();
  });

  test.runIf(process.env.TEMPLATE_VERSION_RELEASE === "1")(
    "releases a pending template change into templates.ts",
    () => {
      const source = fs.readFileSync(templatesPath, "utf-8");
      expect(driftOf(source)).toBeUndefined();

      const result = resolvePendingTemplateVersion(source, renderedTemplatesFingerprint());
      if (result.changed) fs.writeFileSync(templatesPath, result.source, "utf-8");

      expect(readTemplateVersionState(fs.readFileSync(templatesPath, "utf-8"))).toMatchObject({
        changedSinceRelease: false,
        releasedFingerprint: renderedTemplatesFingerprint(),
      });
    },
  );
});
