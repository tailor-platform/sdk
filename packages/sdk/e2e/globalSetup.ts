/**
 * Global teardown for e2e tests - cleans up workspaces and temp dirs even if tests fail
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initOperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";

const TRACKING_DIR = path.join(os.tmpdir(), "e2e-workspaces");
const TEMPDIR_TRACKING_DIR = path.join(os.tmpdir(), "e2e-tempdirs");

/**
 * Track a workspace ID for cleanup in globalTeardown
 * @param workspaceId - The workspace ID to track
 */
export function trackWorkspace(workspaceId: string): void {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });
  fs.writeFileSync(path.join(TRACKING_DIR, workspaceId), "");
}

/**
 * Track a temp directory for cleanup in globalTeardown
 * @param tempDir - The temp directory path to track
 */
export function trackTempDir(tempDir: string): void {
  fs.mkdirSync(TEMPDIR_TRACKING_DIR, { recursive: true });
  // Use base64 to encode path as filename
  const encoded = Buffer.from(tempDir).toString("base64url");
  fs.writeFileSync(path.join(TEMPDIR_TRACKING_DIR, encoded), tempDir);
}

/**
 * Clean up tracked workspaces and temp directories
 */
export async function teardown(): Promise<void> {
  // Clean up temp directories
  if (fs.existsSync(TEMPDIR_TRACKING_DIR)) {
    const files = fs.readdirSync(TEMPDIR_TRACKING_DIR);
    for (const file of files) {
      try {
        const tempDir = fs.readFileSync(path.join(TEMPDIR_TRACKING_DIR, file), "utf-8");
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore
      }
    }
    fs.rmSync(TEMPDIR_TRACKING_DIR, { recursive: true, force: true });
  }

  // Clean up workspaces
  if (!process.env.TAILOR_PLATFORM_TOKEN) return;
  if (!fs.existsSync(TRACKING_DIR)) return;

  const ids = fs.readdirSync(TRACKING_DIR);
  if (ids.length === 0) return;

  fs.rmSync(TRACKING_DIR, { recursive: true, force: true });

  console.log(`[globalTeardown] Cleaning up ${ids.length} workspace(s)...`);
  const token = await loadAccessToken({ useProfile: false });
  const client = await initOperatorClient(token);

  for (const id of ids) {
    try {
      await client.deleteWorkspace({ workspaceId: id });
      console.log(`[globalTeardown] Deleted: ${id}`);
    } catch (e) {
      console.warn(`[globalTeardown] Failed: ${id}`, e);
    }
  }
}
