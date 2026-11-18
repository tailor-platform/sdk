import { guardRequest } from "./request-guard";
import { serveStatic } from "./static-files";

export interface UiHandlerContext {
  basePath: string;
  token: string;
}

export type UiHandler = (
  request: Request,
  context: UiHandlerContext,
) => Response | Promise<Response>;

export type Tab =
  | { id: string; title: string; state: "mounted"; handler: UiHandler }
  | { id: string; title: string; state: "not-installed"; installCommand: string }
  | { id: string; title: string; state: "no-ui-support" };

export interface ShellHandlerOptions {
  tabs: readonly Tab[];
  port: number;
  token: string;
  clientDir?: string;
  onError?: (error: unknown, pluginId: string) => void;
}

const FRAME_ANCESTORS = "frame-ancestors 'self'";

function withFramingProtection(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-frame-options", "SAMEORIGIN");
  const csp = headers.get("content-security-policy");
  headers.set("content-security-policy", csp ? `${csp}; ${FRAME_ANCESTORS}` : FRAME_ANCESTORS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const PLUGIN_PATH = /^\/plugins\/([^/]+)(\/.*)?$/;

function describeTab(tab: Tab) {
  const { id, title, state } = tab;
  return tab.state === "not-installed"
    ? { id, title, state, installCommand: tab.installCommand }
    : { id, title, state };
}

/**
 * Build the request handler of the shell: it guards every request, serves the
 * tab list, and forwards `/plugins/<id>/*` to the plugin's handler.
 * @param options - Tabs, listening port and per-run token
 * @returns A Web-standard fetch handler
 */
export function createShellHandler(options: ShellHandlerOptions) {
  const byId = new Map(options.tabs.map((tab) => [tab.id, tab]));

  const handle = async (request: Request): Promise<Response> => {
    const denied = guardRequest(request, options);
    if (denied) return denied;

    const url = new URL(request.url);
    if (url.pathname === "/api/tabs") return Response.json(options.tabs.map(describeTab));

    const match = PLUGIN_PATH.exec(url.pathname);
    if (!match) {
      return options.clientDir === undefined
        ? new Response("Not Found\n", { status: 404 })
        : serveStatic(options.clientDir, url.pathname);
    }

    const [, id, rest] = match;
    const tab = byId.get(id!);
    if (tab?.state !== "mounted") return new Response("Not Found\n", { status: 404 });
    if (rest === undefined) {
      return new Response(null, { status: 308, headers: { location: `/plugins/${id}/` } });
    }

    const forwardedUrl = new URL(url.origin);
    forwardedUrl.pathname = rest;
    forwardedUrl.search = url.search;
    const forwarded = new Request(forwardedUrl, request);
    try {
      return await tab.handler(forwarded, { basePath: `/plugins/${id}/`, token: options.token });
    } catch (error) {
      options.onError?.(error, id!);
      return new Response("Plugin handler failed\n", { status: 500 });
    }
  };

  return async (request: Request): Promise<Response> =>
    withFramingProtection(await handle(request));
}
