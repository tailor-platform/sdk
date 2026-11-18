import { timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = "x-tailor-studio-token";

const READ_METHODS = new Set(["GET", "HEAD"]);

const LOCAL_FETCH_SITES = new Set(["none", "same-origin"]);

export interface GuardOptions {
  port: number;
  token: string;
}

function forbidden(reason: string): Response {
  return new Response(`Forbidden: ${reason}\n`, { status: 403 });
}

function tokenMatches(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rejects requests that do not come from the local UI itself.
 * @param request - Incoming request
 * @param options - Port the server listens on and the per-run token
 * @returns A 403 response to send, or undefined when the request may proceed
 */
export function guardRequest(request: Request, options: GuardOptions): Response | undefined {
  const allowedHosts = [`127.0.0.1:${options.port}`, `localhost:${options.port}`];
  if (!allowedHosts.includes(request.headers.get("host") ?? "")) {
    return forbidden("unexpected Host header");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && !LOCAL_FETCH_SITES.has(fetchSite)) {
    return forbidden("request from another site");
  }
  if (READ_METHODS.has(request.method.toUpperCase())) return undefined;

  const origin = request.headers.get("origin");
  if (origin !== null && !allowedHosts.some((host) => origin === `http://${host}`)) {
    return forbidden("unexpected Origin header");
  }
  if (!tokenMatches(request.headers.get(TOKEN_HEADER), options.token)) {
    return forbidden("missing or invalid token");
  }
  return undefined;
}
