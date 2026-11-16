import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { runCodemods } from "./runner";
import { runnableCodemod, reviewThroughRunner } from "./test-helpers/codemods";

const CODEMOD_ID = "v2/idp-publish-events-rename";

async function review(lines: string[]) {
  return (await reviewThroughRunner(CODEMOD_ID, lines.join("\n"))).findings;
}

describe("idp-publish-events-rename review findings", () => {
  test("reports nothing when every option the transform rewrites is a direct key", async () => {
    expect(
      await review([
        'import { defineIdp } from "@tailor-platform/sdk";',
        "",
        'export const idp = defineIdp("my-idp", { clients: ["c"], publishUserEvents: true });',
      ]),
    ).toEqual([]);
  });

  test("leaves a nested key belonging to another option shape alone", async () => {
    expect(
      await review([
        'import { defineIdp } from "@tailor-platform/sdk";',
        "",
        'export const idp = defineIdp("my-idp", {',
        '  clients: ["c"],',
        "  userAuthPolicy: { publishUserEvents: true },",
        "});",
      ]),
    ).toEqual([]);
  });

  test("reports an options object the transform cannot reach", async () => {
    const findings = await review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'const options = { clients: ["c"], publishUserEvents: true };',
      'export const idp = defineIdp("my-idp", options);',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("Rename the IdP option");
  });

  test("reports a type declaration of the option", async () => {
    const findings = await review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      "type IdpOptions = {",
      "  publishUserEvents?: boolean;",
      "};",
      "",
      'export const idp = defineIdp("my-idp", { clients: ["c"] });',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(4);
  });

  test("reports an options object the transform skips because of a type assertion", async () => {
    const findings = await review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'export const idp = defineIdp("my-idp", { clients: ["c"], publishUserEvents: true } as const);',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("Rename the IdP option");
  });

  test("reports a computed option key that may be the renamed option", async () => {
    const findings = await review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'const key = "publishUserEvents";',
      'export const idp = defineIdp("my-idp", { clients: ["c"], [key]: true });',
    ]);

    expect(findings.map((finding) => finding.message)).toContain(
      "A computed defineIdp option key may be publishUserEvents; rename it to publishEvents if so.",
    );
  });

  test("reports once when a local declaration shadows the defineIdp import", async () => {
    const findings = await review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      "function wrap() {",
      "  const defineIdp = (name: string, config: { publishUserEvents?: boolean }) => ({ name, config });",
      '  return defineIdp("my-idp", { publishUserEvents: true });',
      "}",
      "",
      "export const wrapped = wrap();",
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("shadows the SDK defineIdp import");
  });

  test("reports nothing for a file that never imports the SDK", async () => {
    expect(
      await review([
        'import { defineIdp } from "./local-idp";',
        "",
        'export const idp = defineIdp("my-idp", { publishUserEvents: true });',
      ]),
    ).toEqual([]);
  });

  test("reports a quoted key in an options object the transform cannot reach", async () => {
    const findings = await review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'const options = { clients: ["c"], "publishUserEvents": true };',
      'export const idp = defineIdp("my-idp", options);',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("Rename the IdP option");
  });

  test("reports nothing for a quoted key the transform rewrites in place", async () => {
    expect(
      await review([
        'import { defineIdp } from "@tailor-platform/sdk";',
        "",
        'export const idp = defineIdp("my-idp", { "publishUserEvents": true });',
      ]),
    ).toEqual([]);
  });

  test("does not warn that a migrated shorthand option was left unmigrated", async () => {
    const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "idp-publish-events-"));

    try {
      await fs.promises.writeFile(
        path.join(projectDir, "tailor.config.ts"),
        [
          'import { defineIdp } from "@tailor-platform/sdk";',
          "",
          "const publishUserEvents = true;",
          'export const idp = defineIdp("my-idp", { clients: ["c"], publishUserEvents });',
          "",
        ].join("\n"),
        "utf-8",
      );

      const result = await runCodemods([runnableCodemod(CODEMOD_ID)], projectDir, false);

      // The rewrite keeps reading the same local, so the legacy name survives on
      // purpose. Matching it as a residual reports every success as a failure.
      await expect(
        fs.promises.readFile(path.join(projectDir, "tailor.config.ts"), "utf-8"),
      ).resolves.toContain("publishEvents: publishUserEvents");
      expect(result.warnings.filter((w) => w.includes("was not migrated automatically"))).toEqual(
        [],
      );
    } finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    }
  });
});
