import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import type { TailorDbErdSchema } from "./types";

const VIEWER_ASSETS_DIR = "erd-viewer-assets";
const STYLES_LINK = '<link rel="stylesheet" href="./styles.css" />';
const APP_SCRIPT = '<script src="./app.js" type="module"></script>';

export interface WriteViewerDistOptions {
  schema: TailorDbErdSchema;
  distDir: string;
}

export interface BuildViewerHtmlOptions {
  schema: TailorDbErdSchema;
  currentSchema?: TailorDbErdSchema;
  diff?: unknown;
  title?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
 * Build the self-contained ERD viewer HTML document. CSS, JS, and the schema
 * are inlined as separately extractable blocks: a `<style>` element, a
 * `<script type="module">`, and a `<script type="application/json"
 * id="erd-schema">` data block. This renders without any sibling asset files
 * and lets external tooling (including the ERD diff command) pull out the
 * schema via `JSON.parse`.
 * @param options - Viewer build options.
 * @returns The self-contained HTML document.
 */
export function buildViewerHtml(options: BuildViewerHtmlOptions): string {
  const assetsDir = resolveViewerAssetsDir();
  const html = fs.readFileSync(path.join(assetsDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(assetsDir, "styles.css"), "utf8");
  const appJs = fs.readFileSync(path.join(assetsDir, "app.js"), "utf8");

  if (!html.includes(STYLES_LINK) || !html.includes(APP_SCRIPT)) {
    throw new Error("ERD viewer index.html is missing expected asset references for inlining.");
  }

  // Embed schemas as JSON data (not executable JS) so they are both consumed by
  // the viewer and trivially extractable by external tooling. Escape "<" so a
  // value like "</script>" cannot terminate the data
  // <script> element early; JSON.parse restores the original characters.
  const schemaJson = JSON.stringify(options.schema).replaceAll("<", "\\u003c");
  const embedScript = `<script type="application/json" id="erd-schema">${schemaJson}</script>`;
  const currentSchemaScript =
    options.currentSchema === undefined
      ? ""
      : `\n    <script type="application/json" id="erd-current-schema">${JSON.stringify(
          options.currentSchema,
        ).replaceAll("<", "\\u003c")}</script>`;
  const diffScript =
    options.diff === undefined
      ? ""
      : `\n    <script type="application/json" id="erd-diff">${JSON.stringify(
          options.diff,
        ).replaceAll("<", "\\u003c")}</script>`;
  // Escape any "</script" in the inlined module so it cannot terminate the
  // <script> element early. "<\/script" is equivalent JS (\/ === /).
  const safeAppJs = appJs.replace(/<\/script/gi, "<\\/script");
  const inlineScript = `<script type="module">\n${safeAppJs}\n</script>`;

  return html
    .replace(
      "<title>TailorDB ERD</title>",
      () => `<title>${escapeHtml(options.title ?? "TailorDB ERD")}</title>`,
    )
    .replace(STYLES_LINK, () => `<style>\n${css}\n</style>`)
    .replace(
      APP_SCRIPT,
      () => `${embedScript}${currentSchemaScript}${diffScript}\n    ${inlineScript}`,
    );
}

/**
 * Write the self-contained TailorDB ERD viewer to `<distDir>/index.html`.
 * @param options - Viewer dist write options.
 */
export function writeViewerDist(options: WriteViewerDistOptions): void {
  fs.rmSync(options.distDir, { recursive: true, force: true });
  fs.mkdirSync(options.distDir, { recursive: true });
  fs.writeFileSync(
    path.join(options.distDir, "index.html"),
    buildViewerHtml({ schema: options.schema }),
    "utf8",
  );
}
