import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { writeTailorDbErdSchemaToFile } from "./schema";
import type { TailorDbErdSchema } from "./types";

const VIEWER_ASSETS_DIR = "erd-viewer-assets";
const STYLES_LINK = '<link rel="stylesheet" href="./styles.css" />';
const APP_SCRIPT = '<script src="./app.js" type="module"></script>';

export interface WriteViewerDistOptions {
  schema: TailorDbErdSchema;
  distDir: string;
  /**
   * When true, emit a single self-contained `index.html` (inlined CSS/JS and
   * embedded schema) instead of the multi-file dist. Useful where external
   * asset links are not loaded, such as previewing CI artifacts in a browser.
   */
  inline?: boolean;
}

export interface BuildStandaloneViewerHtmlOptions {
  schema: TailorDbErdSchema;
}

function assetDirCandidates(): string[] {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(currentDir, "viewer-assets"),
    path.join(currentDir, VIEWER_ASSETS_DIR),
    path.join(currentDir, "commands", "tailordb", "erd", VIEWER_ASSETS_DIR),
    path.resolve(process.cwd(), "packages/sdk/src/cli/commands/tailordb/erd/viewer-assets"),
  ];
}

/**
 * Resolve the packaged ERD viewer asset directory.
 * @returns Absolute path to the viewer asset directory.
 */
export function resolveViewerAssetsDir(): string {
  for (const candidate of assetDirCandidates()) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw new Error(`ERD viewer assets not found. Checked: ${assetDirCandidates().join(", ")}`);
}

/**
 * Build a single self-contained ERD viewer HTML document with inlined CSS/JS
 * and an embedded schema, so it renders without any sibling asset files.
 * @param options - Standalone build options.
 * @returns The self-contained HTML document.
 */
export function buildStandaloneViewerHtml(options: BuildStandaloneViewerHtmlOptions): string {
  const assetsDir = resolveViewerAssetsDir();
  const html = fs.readFileSync(path.join(assetsDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(assetsDir, "styles.css"), "utf8");
  const appJs = fs.readFileSync(path.join(assetsDir, "app.js"), "utf8");

  if (!html.includes(STYLES_LINK) || !html.includes(APP_SCRIPT)) {
    throw new Error("ERD viewer index.html is missing expected asset references for inlining.");
  }

  // Escape "<" so values like "</script>" inside the schema cannot terminate the
  // embedding <script> element early.
  const schemaJson = JSON.stringify(options.schema).replaceAll("<", "\\u003c");
  const embedScript = `<script>window.__ERD_SCHEMA__ = ${schemaJson};</script>`;
  const inlineScript = `<script type="module">\n${appJs}\n</script>`;

  return html
    .replace(STYLES_LINK, `<style>\n${css}\n</style>`)
    .replace(APP_SCRIPT, `${embedScript}\n    ${inlineScript}`);
}

/**
 * Write a static TailorDB ERD viewer dist directory.
 * @param options - Viewer dist write options.
 */
export function writeViewerDist(options: WriteViewerDistOptions): void {
  fs.rmSync(options.distDir, { recursive: true, force: true });
  fs.mkdirSync(options.distDir, { recursive: true });
  if (options.inline) {
    fs.writeFileSync(
      path.join(options.distDir, "index.html"),
      buildStandaloneViewerHtml({ schema: options.schema }),
      "utf8",
    );
    return;
  }
  fs.cpSync(resolveViewerAssetsDir(), options.distDir, { recursive: true });
  writeTailorDbErdSchemaToFile({
    schema: options.schema,
    outputPath: path.join(options.distDir, "schema.json"),
  });
}
