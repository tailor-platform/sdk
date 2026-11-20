import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { discoverTab } from "./discover-tab";

const SPEC = { id: "fake", title: "Fake", packageName: "@scope/sdk-plugin-fake" };

let project: string;

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-studio-"));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

function install(packageJson: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = path.join(project, "node_modules", SPEC.packageName);
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: SPEC.packageName,
      version: "1.0.0",
      type: "module",
      exports: { ".": { default: "./dist/index.js" } },
      ...packageJson,
    }),
  );
  fs.writeFileSync(path.join(dir, "dist", "index.js"), "export {};\n");
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

describe("discoverTab", () => {
  test("reports not-installed with the install command when the package is absent", async () => {
    expect(await discoverTab(SPEC, project)).toEqual({
      id: "fake",
      title: "Fake",
      state: "not-installed",
      installCommand: "pnpm add -D @scope/sdk-plugin-fake",
    });
  });

  test("reports no-ui-support when the installed version declares no UI", async () => {
    install({});
    expect(await discoverTab(SPEC, project)).toEqual({
      id: "fake",
      title: "Fake",
      state: "no-ui-support",
    });
  });

  test("mounts the handler exported by the declared entry", async () => {
    install(
      { tailorUi: { id: "fake", title: "Fake", kind: "module", entry: "./dist/ui.js" } },
      { "dist/ui.js": 'export default () => new Response("from plugin");\n' },
    );
    const tab = await discoverTab(SPEC, project);
    if (tab.state !== "mounted") throw new Error(`unexpected state ${tab.state}`);
    const res = await tab.handler(new Request("http://x/"), {
      basePath: "/plugins/fake/",
      token: "t",
      getSelection: () => ({}),
    });
    expect(await res.text()).toBe("from plugin");
  });

  test("rejects a declared process kind as unsupported", async () => {
    install({ tailorUi: { id: "fake", title: "Fake", kind: "process", command: "x" } });
    await expect(discoverTab(SPEC, project)).rejects.toThrow(/kind "process" is not supported/);
  });

  test("rejects a manifest whose id differs from the tab it is mounted as", async () => {
    install({ tailorUi: { id: "other", title: "Fake", kind: "module", entry: "./dist/ui.js" } });
    await expect(discoverTab(SPEC, project)).rejects.toThrow(/other/);
  });

  test("rejects an entry that does not export a handler function", async () => {
    install(
      { tailorUi: { id: "fake", title: "Fake", kind: "module", entry: "./dist/ui.js" } },
      { "dist/ui.js": "export default 1;\n" },
    );
    await expect(discoverTab(SPEC, project)).rejects.toThrow(/default export/);
  });
});
