import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { reviewFindings } from "../codemods/v2/idp-publish-events-rename/scripts/transform";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";

const filePath = "/repo/tailor.config.ts";
const relativePath = "tailor.config.ts";

function review(lines: string[]) {
  return reviewFindings(lines.join("\n"), filePath, relativePath);
}

describe("idp-publish-events-rename review findings", () => {
  test("reports nothing when every option the transform rewrites is a direct key", () => {
    expect(
      review([
        'import { defineIdp } from "@tailor-platform/sdk";',
        "",
        'export const idp = defineIdp("my-idp", { clients: ["c"], publishUserEvents: true });',
      ]),
    ).toEqual([]);
  });

  test("leaves a nested key belonging to another option shape alone", () => {
    expect(
      review([
        'import { defineIdp } from "@tailor-platform/sdk";',
        "",
        'export const idp = defineIdp("my-idp", {',
        '  clients: ["c"],',
        "  userAuthPolicy: { publishUserEvents: true },",
        "});",
      ]),
    ).toEqual([]);
  });

  test("reports an options object the transform cannot reach", () => {
    const findings = review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'const options = { clients: ["c"], publishUserEvents: true };',
      'export const idp = defineIdp("my-idp", options);',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("Rename the IdP option");
  });

  test("reports a type declaration of the option", () => {
    const findings = review([
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

  test("reports an options object the transform skips because of a type assertion", () => {
    const findings = review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'export const idp = defineIdp("my-idp", { clients: ["c"], publishUserEvents: true } as const);',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("Rename the IdP option");
  });

  test("reports a computed option key that may be the renamed option", () => {
    const findings = review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'const key = "publishUserEvents";',
      'export const idp = defineIdp("my-idp", { clients: ["c"], [key]: true });',
    ]);

    expect(findings.map((finding) => finding.message)).toContain(
      "A computed defineIdp option key may be publishUserEvents; rename it to publishEvents if so.",
    );
  });

  test("reports once when a local declaration shadows the defineIdp import", () => {
    const findings = review([
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

  test("reports nothing for a file that never imports the SDK", () => {
    expect(
      review([
        'import { defineIdp } from "./local-idp";',
        "",
        'export const idp = defineIdp("my-idp", { publishUserEvents: true });',
      ]),
    ).toEqual([]);
  });

  test("reports a quoted key in an options object the transform cannot reach", () => {
    const findings = review([
      'import { defineIdp } from "@tailor-platform/sdk";',
      "",
      'const options = { clients: ["c"], "publishUserEvents": true };',
      'export const idp = defineIdp("my-idp", options);',
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("Rename the IdP option");
  });

  test("reports nothing for a quoted key the transform rewrites in place", () => {
    expect(
      review([
        'import { defineIdp } from "@tailor-platform/sdk";',
        "",
        'export const idp = defineIdp("my-idp", { "publishUserEvents": true });',
      ]),
    ).toEqual([]);
  });

  test("does not warn that a migrated shorthand option was left unmigrated", async () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/idp-publish-events-rename");
    expect(codemod).toBeDefined();
    if (!codemod) throw new Error("idp publishEvents codemod is not registered");

    const scriptPath = path.resolve(
      __dirname,
      "../codemods/v2/idp-publish-events-rename/scripts/transform.ts",
    );
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

      const result = await runCodemods([{ codemod, scriptPath }], projectDir, false);

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
