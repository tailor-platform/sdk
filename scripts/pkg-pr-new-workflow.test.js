import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/pkg-pr-new.yml", import.meta.url),
  "utf8",
);

describe("pkg.pr.new workflow", () => {
  test("uses repository-qualified preview URLs for the combined publish", () => {
    for (const packageName of ["sdk", "create-sdk", "sdk-plugin-seed"]) {
      expect(workflow).toContain(
        `https://pkg.pr.new/tailor-platform/sdk/@tailor-platform/${packageName}@\${SHA}`,
      );
    }

    expect(workflow).not.toContain("SHORT_SHA");

    const publishCommand = workflow.split("\n").find((line) => line.includes("pkg-pr-new publish"));
    expect(publishCommand).toBeDefined();
    expect(publishCommand).toContain("--no-compact");
  });

  test("smoke-tests the generators template seed dependency", () => {
    expect(workflow).toContain("template: generators");
    expect(workflow).toContain("EXPECTED_SEED_PLUGIN_URL");
    expect(workflow).toContain('.devDependencies["@tailor-platform/sdk-plugin-seed"]');
  });
});
