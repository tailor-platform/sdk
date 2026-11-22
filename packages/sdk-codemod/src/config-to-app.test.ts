import { describe, expect, test } from "vitest";
import { createProject, runOnProject } from "./test-helpers/project";

const APP_ID = "8b1f4c1e-2f6a-4c55-9a43-5d1f0c3e7a21";
const CODEMODS = ["v3/config-to-app"];
const TAKEOVER_WARNING =
  "tailor.config.ts: the next `tailor deploy` asks to take over the resources that defineConfig() deployed. Check its plan with `tailor deploy --dry-run` first, then run it where it can prompt, or pass --yes.";

function lock(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ version: 2, targets: [], ...fields }, null, 2)}\n`;
}

function lines(...source: string[]): string {
  return `${source.join("\n")}\n`;
}

function findingsOf(result: Awaited<ReturnType<typeof runOnProject>>) {
  return result.llmReviews
    .filter((review) => review.codemodId === "v3/config-to-app")
    .flatMap((review) => review.findings ?? [])
    .map(({ file, line, message }) => ({ file, line, message }));
}

describe("v3/config-to-app", () => {
  test("rewrites defineConfig to defineApp, drops the id, and records the config as a workspace config", async () => {
    const project = createProject({
      "tailor.config.ts": lines(
        'import { defineAuth, defineConfig } from "@tailor-platform/sdk";',
        "",
        'const auth = defineAuth("shop-auth", { machineUsers: { admin: {} } });',
        "",
        "export default defineConfig({",
        `  id: "${APP_ID}",`,
        '  name: "shop",',
        "  auth,",
        '  db: { main: { files: ["./db/*.ts"] } },',
        "});",
      ),
      ".github/tailor.lock": lock({ appIds: { "tailor.config.ts": APP_ID } }),
    });

    const result = await runOnProject(CODEMODS, project);

    expect(project.read("tailor.config.ts")).toBe(
      lines(
        'import { defineAuth, defineApp } from "@tailor-platform/sdk";',
        "",
        'const auth = defineAuth("shop-auth", { machineUsers: { admin: {} } });',
        "",
        "export default defineApp({",
        '  name: "shop",',
        "  auth,",
        '  db: { main: { files: ["./db/*.ts"] } },',
        "});",
      ),
    );
    expect(project.read(".github/tailor.lock")).toBe(
      `${JSON.stringify({ version: 3, targets: [], appIds: {}, workspaces: ["tailor.config.ts"] }, null, 2)}\n`,
    );
    expect(result.warnings).toEqual([TAKEOVER_WARNING]);
    expect(findingsOf(result)).toEqual([]);

    const rerun = await runOnProject(CODEMODS, project);
    expect(rerun.filesModified).toEqual([]);
    expect(rerun.warnings).toEqual([]);
  });

  test.each([
    [
      'import * as sdk from "@tailor-platform/sdk";',
      "export default sdk.defineConfig({",
      'import * as sdk from "@tailor-platform/sdk";',
      "export default sdk.defineApp({",
    ],
    [
      'import { defineConfig as config } from "@tailor-platform/sdk";',
      "export default config({",
      'import { defineApp as config } from "@tailor-platform/sdk";',
      "export default config({",
    ],
  ])("rewrites %s", async (importLine, callLine, convertedImport, convertedCall) => {
    const project = createProject({
      "apps/shop/tailor.config.ts": lines(importLine, "", callLine, '  name: "shop",', "});"),
    });

    await runOnProject(CODEMODS, project);

    expect(project.read("apps/shop/tailor.config.ts")).toBe(
      lines(convertedImport, "", convertedCall, '  name: "shop",', "});"),
    );
  });

  test.each([
    ['  db: { "shared-db": { external: true } },', 'db namespace "shared-db"'],
    ['  resolver: { "shared-api": { external: true } },', 'resolver namespace "shared-api"'],
    ['  auth: { name: "shared-auth", external: true },', 'Auth service "shared-auth"'],
    ["  auth: sharedAuth.asExternal(),", "Auth service"],
    ['  idp: { name: "shared-idp", external: true },', 'IdP "shared-idp"'],
  ])("leaves a config that uses a service it does not define: %s", async (entry, service) => {
    const source = lines(
      'import { defineConfig } from "@tailor-platform/sdk";',
      'import { sharedAuth } from "./shared";',
      "",
      "export default defineConfig({",
      '  name: "shop",',
      entry,
      "});",
    );
    const project = createProject({ "tailor.config.ts": source });

    const result = await runOnProject(CODEMODS, project);

    expect(project.read("tailor.config.ts")).toBe(source);
    expect(findingsOf(result)).toEqual([
      {
        file: "tailor.config.ts",
        line: 6,
        message: `The ${service} is external, but no config in this project defines it, so the config was not converted.`,
      },
    ]);
  });

  test("reports a config whose default export is not a defineConfig() call with an object literal", async () => {
    const source = lines(
      'import { defineConfig } from "@tailor-platform/sdk";',
      "",
      'const config = defineConfig({ name: "shop" });',
      "export default config;",
    );
    const project = createProject({ "tailor.config.ts": source });

    const result = await runOnProject(CODEMODS, project);

    expect(project.read("tailor.config.ts")).toBe(source);
    expect(findingsOf(result)).toEqual([
      {
        file: "tailor.config.ts",
        line: 3,
        message:
          "The config is not exported as `export default defineConfig({ ... })`, so it was not converted.",
      },
    ]);
  });

  test("keeps every IdP of a config that lists several by converting it to a one-application workspace config", async () => {
    const project = createProject({
      "tailor.config.ts": lines(
        'import { defineAuth, defineConfig, defineIdp } from "@tailor-platform/sdk";',
        "",
        'const idp = defineIdp("shop-idp", { clients: ["web"] });',
        'const partnerIdp = defineIdp("partner-idp", { clients: ["partner"] });',
        'const auth = defineAuth("shop-auth", { idProvider: idp.provider("web", "web") });',
        "",
        "export default defineConfig({",
        '  name: "shop",',
        '  cors: ["https://shop.example.com"],',
        "  auth,",
        "  idp: [idp, partnerIdp],",
        '  db: { main: { files: ["./db/*.ts"] } },',
        "});",
      ),
    });

    const result = await runOnProject(CODEMODS, project);

    expect(project.read("tailor.config.ts")).toBe(
      lines(
        'import { defineAuth, defineWorkspace, defineIdp } from "@tailor-platform/sdk";',
        "",
        'const idp = defineIdp("shop-idp", { clients: ["web"] });',
        'const partnerIdp = defineIdp("partner-idp", { clients: ["partner"] });',
        'const auth = defineAuth("shop-auth", { idProvider: idp.provider("web", "web") });',
        "",
        "export default defineWorkspace({",
        '  db: { main: { files: ["./db/*.ts"] } },',
        "  auth: { [auth.name]: auth },",
        "  idp: { [idp.name]: idp, [partnerIdp.name]: partnerIdp },",
        "  apps: {",
        "    shop: {",
        '      cors: ["https://shop.example.com"],',
        '      db: ["main"],',
        "      auth: auth.name,",
        "      idp: [idp.name],",
        "    },",
        "  },",
        "});",
      ),
    );
    expect(result.warnings).toContain(
      "tailor.config.ts: application shop exposes only the first of its IdPs (shop-idp) in its GraphQL API, as before; the others (partner-idp) stay defined in the workspace.",
    );
  });

  test.each([
    [
      "a spread",
      ["const base = { cors: [] };", 'export default defineConfig({ ...base, name: "shop" });'],
      "The config has a spread or a computed key, which may hold settings defineApp() does not take, so it was not converted.",
    ],
    [
      "an idp it cannot read",
      [
        "const idps = [shopIdp, partnerIdp];",
        'export default defineConfig({ name: "shop", idp: idps });',
      ],
      "The conversion cannot tell which IdPs `idp` holds, so the config was not converted. A defineApp() config takes one IdP; a config with several becomes a defineWorkspace() config with one application.",
    ],
  ])("leaves a config with %s", async (_, body, message) => {
    const source = lines('import { defineConfig } from "@tailor-platform/sdk";', ...body);
    const project = createProject({ "tailor.config.ts": source });

    const result = await runOnProject(CODEMODS, project);

    expect(project.read("tailor.config.ts")).toBe(source);
    expect(findingsOf(result).map((finding) => finding.message)).toEqual([message]);
  });

  test("converts a config with another file name that a deploy script names", async () => {
    const project = createProject({
      "package.json": `${JSON.stringify({ scripts: { deploy: "tailor deploy -c apps/shop/app.config.ts" } })}\n`,
      "apps/shop/app.config.ts": lines(
        'import { defineConfig } from "@tailor-platform/sdk";',
        'export default defineConfig({ name: "shop" });',
      ),
    });

    await runOnProject(CODEMODS, project);

    expect(project.read("apps/shop/app.config.ts")).toContain("export default defineApp({");
  });

  test("leaves a config that a setup target deploys together with a config outside the upgraded directory", async () => {
    const config = (name: string) =>
      lines(
        'import { defineConfig } from "@tailor-platform/sdk";',
        `export default defineConfig({ name: "${name}" });`,
      );
    const project = createProject({
      ".git/": "",
      ".github/tailor.lock": lock({
        targets: [
          {
            kind: "branch",
            workspaceName: "shop",
            inputs: { dir: ".", apps: [{ dir: "apps/user" }, { dir: "apps/admin" }] },
          },
        ],
      }),
      "apps/user/tailor.config.ts": config("user"),
      "apps/admin/tailor.config.ts": config("admin"),
    });

    const result = await runOnProject(CODEMODS, project, "apps/user");

    expect(project.read("apps/user/tailor.config.ts")).toBe(config("user"));
    expect(findingsOf(result).map((finding) => finding.message)).toEqual([
      "../../.github/tailor.lock deploys this config together with ../admin, outside the upgraded directory, so it was not converted. Run the upgrade from a directory that holds all of them.",
    ]);
  });

  test("converts the config and warns when the lock is not JSON", async () => {
    const project = createProject({
      "tailor.config.ts": lines(
        'import { defineConfig } from "@tailor-platform/sdk";',
        'export default defineConfig({ name: "shop" });',
      ),
      ".github/tailor.lock": "{",
    });

    const result = await runOnProject(CODEMODS, project);

    expect(project.read(".github/tailor.lock")).toBe("{");
    expect(result.warnings).toContain(
      ".github/tailor.lock is not a JSON object, so the conversion left it as it is. Record each converted config under `workspaces` and remove its `appIds` entry by hand.",
    );
  });
});
