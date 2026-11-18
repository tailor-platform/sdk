import * as fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { parseUiManifest } from "./manifest";
import type { Tab, UiHandler } from "./shell-handler";

export interface TabSpec {
  id: string;
  title: string;
  packageName: string;
}

function resolvePackageDir(packageName: string, projectDir: string): string | undefined {
  let entry: string;
  try {
    entry = createRequire(path.join(projectDir, "noop.js")).resolve(packageName);
  } catch {
    return undefined;
  }
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      const name = (JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string }).name;
      if (name === packageName) return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Work out what a tab shows: the plugin's UI, a note that this version has no
 * UI yet, or how to install the plugin.
 * @param spec - Tab id, title and the npm package that provides it
 * @param projectDir - Project directory the package is resolved from
 * @returns The tab, ready for the shell
 */
export async function discoverTab(spec: TabSpec, projectDir: string): Promise<Tab> {
  const { id, title, packageName } = spec;
  const packageDir = resolvePackageDir(packageName, projectDir);
  if (packageDir === undefined) {
    return { id, title, state: "not-installed", installCommand: `pnpm add -D ${packageName}` };
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as {
    tailorUi?: unknown;
  };
  if (packageJson.tailorUi === undefined) return { id, title, state: "no-ui-support" };

  const manifest = parseUiManifest(packageJson.tailorUi);
  if (manifest.id !== id) {
    throw new Error(`${packageName} declares UI id "${manifest.id}", expected "${id}".`);
  }
  const entry = pathToFileURL(path.resolve(packageDir, manifest.entry)).href;
  const handler = ((await import(entry)) as { default?: unknown }).default;
  if (typeof handler !== "function") {
    throw new Error(
      `${packageName}: ${manifest.entry} must have a default export that is a handler function.`,
    );
  }
  return { id, title, state: "mounted", handler: handler as UiHandler };
}
