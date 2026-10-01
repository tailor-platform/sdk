import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { fingerprintOf, renderedTemplatesFingerprint } from "./template-fingerprint";
import { readTemplateVersionState, templateVersionDrift } from "./template-version";

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

describe("template version", () => {
  test("marks a template change as pending until the next release records it", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "templates.ts"), "utf-8");
    const recorded = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "template-fingerprint.json"), "utf-8"),
    ) as { version: number; hash: string };

    const drift = templateVersionDrift({
      ...readTemplateVersionState(source),
      recorded,
      currentHash: renderedTemplatesFingerprint(),
    });

    expect(drift).toBeUndefined();
  });
});
