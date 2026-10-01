import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { fingerprintOf, renderedTemplatesFingerprint } from "./template-fingerprint";
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

describe("template version", () => {
  const templatesPath = path.join(import.meta.dirname, "templates.ts");
  const releasing = process.env.TEMPLATE_VERSION_RELEASE === "1";

  test.skipIf(releasing)(
    "marks a template change as pending until the next release records it",
    () => {
      const drift = templateVersionDrift({
        ...readTemplateVersionState(fs.readFileSync(templatesPath, "utf-8")),
        currentHash: renderedTemplatesFingerprint(),
      });

      expect(drift).toBeUndefined();
    },
  );

  test.runIf(releasing)("releases a pending template change into templates.ts", () => {
    const result = resolvePendingTemplateVersion(
      fs.readFileSync(templatesPath, "utf-8"),
      renderedTemplatesFingerprint(),
    );
    if (result.changed) fs.writeFileSync(templatesPath, result.source, "utf-8");

    expect(readTemplateVersionState(fs.readFileSync(templatesPath, "utf-8"))).toMatchObject({
      changedSinceRelease: false,
      releasedFingerprint: renderedTemplatesFingerprint(),
    });
  });
});
