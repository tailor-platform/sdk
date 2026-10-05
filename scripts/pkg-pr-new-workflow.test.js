import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/pkg-pr-new.yml", import.meta.url),
  "utf8",
);

describe("pkg.pr.new workflow", () => {
  test("uses repository-qualified preview URLs for the combined publish", () => {
    for (const packageName of ["sdk", "create-sdk", "sdk-plugin-seed", "sdk-plugin-frontend"]) {
      expect(workflow).toContain(
        `https://pkg.pr.new/tailor-platform/sdk/@tailor-platform/${packageName}@\${SHA}`,
      );
    }

    expect(workflow).not.toContain("SHORT_SHA");

    const publishCommand = workflow.split("\n").find((line) => line.includes("pkg-pr-new publish"));
    expect(publishCommand).toBeDefined();
    expect(publishCommand).toContain("--no-compact");
    expect(publishCommand).toContain('"packages/sdk-plugin-frontend"');
  });

  test("builds the frontend plugin before publishing and checks its changesets", () => {
    const installAction = readFileSync(
      new URL("../.github/actions/install-deps/action.yml", import.meta.url),
      "utf8",
    );
    const changesetWorkflow = readFileSync(
      new URL("../.github/workflows/changeset-check.yml", import.meta.url),
      "utf8",
    );
    expect(installAction).toContain("--filter @tailor-platform/sdk-plugin-frontend");
    expect(changesetWorkflow).toContain("packages/sdk-plugin-frontend/**");
    expect(workflow).toContain(
      "frontend_plugin_url: ${{ steps.urls.outputs.frontend_plugin_url }}",
    );
  });

  test("smoke-tests the generators template seed dependency", () => {
    expect(workflow).toContain("template: generators");
    expect(workflow).toContain("EXPECTED_SEED_PLUGIN_URL");
    expect(workflow).toContain('.devDependencies["@tailor-platform/sdk-plugin-seed"]');
  });

  test("scopes the pnpm smoke-test install to the SDK's own postinstall", () => {
    expect(workflow).toContain("pnpm install --ignore-scripts");
    expect(workflow).toContain("node node_modules/@tailor-platform/sdk/postinstall.mjs");
  });
});
