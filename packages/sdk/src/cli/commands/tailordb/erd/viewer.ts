import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { writeTailorDbErdSchemaToFile } from "./schema";
import type { TailorDbErdSchema } from "./types";

const VIEWER_ASSETS_DIR = "erd-viewer-assets";

export interface WriteViewerDistOptions {
  schema: TailorDbErdSchema;
  distDir: string;
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
 * Write a static TailorDB ERD viewer dist directory.
 * @param options - Viewer dist write options.
 */
export function writeViewerDist(options: WriteViewerDistOptions): void {
  fs.rmSync(options.distDir, { recursive: true, force: true });
  fs.mkdirSync(options.distDir, { recursive: true });
  fs.cpSync(resolveViewerAssetsDir(), options.distDir, { recursive: true });
  writeTailorDbErdSchemaToFile({
    schema: options.schema,
    outputPath: path.join(options.distDir, "schema.json"),
  });
}
