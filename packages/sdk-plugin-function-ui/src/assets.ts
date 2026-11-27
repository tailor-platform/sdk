import { readFile } from "node:fs/promises";
import * as path from "pathe";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Serve one built file of the page.
 * @param root - Directory holding the built `assets/` files
 * @param name - File name below `root`, as the URL gives it
 * @returns The file, or a 404 when it is missing or points outside `root`
 */
export async function serveAsset(root: string, name: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return new Response("Not Found\n", { status: 404 });
  }
  const base = path.resolve(root);
  const file = path.resolve(base, decoded);
  if (decoded.includes("\0") || !file.startsWith(`${base}/`)) {
    return new Response("Not Found\n", { status: 404 });
  }
  try {
    const body = await readFile(file);
    const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
    return new Response(body, { headers: { "content-type": type } });
  } catch {
    return new Response("Not Found\n", { status: 404 });
  }
}
