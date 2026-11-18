import { readFile } from "node:fs/promises";
import * as path from "pathe";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function notFound(): Response {
  return new Response("Not Found\n", { status: 404 });
}

async function readInside(root: string, relative: string): Promise<Response | undefined> {
  const file = path.resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(`${root}/`)) return undefined;
  try {
    const body = await readFile(file);
    const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
    return new Response(body, { headers: { "content-type": type } });
  } catch {
    return undefined;
  }
}

/**
 * Serve a file below `root`, falling back to `index.html` for routes the
 * client renders itself (paths without an extension).
 * @param root - Directory holding the built client
 * @param pathname - URL path of the request
 * @returns The file, the fallback page, or a 404
 */
export async function serveStatic(root: string, pathname: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  const resolvedRoot = path.resolve(root);
  const target = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const direct = decoded.includes("\0") ? undefined : await readInside(resolvedRoot, target);
  if (direct) return direct;
  if (path.extname(decoded) !== "") return notFound();
  return (await readInside(resolvedRoot, "/index.html")) ?? notFound();
}
