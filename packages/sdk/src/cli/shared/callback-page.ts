import { isCLIError } from "./errors";
import type * as http from "node:http";

type CallbackPageOptions = {
  status: "success" | "failure";
  title: string;
  message: string;
};

const htmlEscapes = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
} as const;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes[char as keyof typeof htmlEscapes]);
}

const icons = {
  success:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  failure:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const styles = `
:root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--text:#16181d;--muted:#5d6470;--border:#e2e5ea;--ok:#15803d;--ok-bg:#dcfce7;--ng:#b91c1c;--ng-bg:#fee2e2}
@media (prefers-color-scheme: dark){:root{--bg:#0f1115;--card:#181b21;--text:#f2f4f8;--muted:#9aa3b2;--border:#2a2f38;--ok:#4ade80;--ok-bg:#12301d;--ng:#f87171;--ng-bg:#3a1717}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:420px;padding:32px 28px;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:16px}
.icon{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%}
.success .icon{color:var(--ok);background:var(--ok-bg)}
.failure .icon{color:var(--ng);background:var(--ng-bg)}
h1{margin:16px 0 8px;font-size:20px}
p{margin:0;color:var(--muted);overflow-wrap:anywhere}
`.replace(/\n/g, "");

const closeScript = "<script>window.close()</script>";

/**
 * Render the HTML page shown in the browser after a local OAuth2 callback.
 * @param options - Page content. `title` and `message` are HTML-escaped.
 * @returns HTML document
 */
export function renderCallbackPage(options: CallbackPageOptions) {
  const title = escapeHtml(options.title);
  const message = escapeHtml(options.message);
  const script = options.status === "success" ? closeScript : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${styles}</style></head><body class="${options.status}"><main><div class="icon">${icons[options.status]}</div><h1>${title}</h1><p>${message}</p></main>${script}</body></html>`;
}

const htmlHeaders = { "Content-Type": "text/html; charset=utf-8" };

/**
 * Respond to a local OAuth2 callback request with the success page.
 * @param res - Callback server response
 * @param title - Page title and heading
 */
export function sendCallbackSuccess(res: http.ServerResponse, title: string) {
  res.writeHead(200, htmlHeaders);
  res.end(
    renderCallbackPage({
      status: "success",
      title,
      message: "You can close this tab and return to the terminal.",
    }),
  );
}

/**
 * Respond to a local OAuth2 callback request with the failure page. Only the
 * message of a `CLIError` is shown; other errors fall back to a generic hint.
 * @param res - Callback server response
 * @param statusCode - HTTP status to respond with
 * @param title - Page title and heading
 * @param error - Error that caused the failure
 */
export function sendCallbackFailure(
  res: http.ServerResponse,
  statusCode: number,
  title: string,
  error: unknown,
) {
  res.writeHead(statusCode, htmlHeaders);
  res.end(
    renderCallbackPage({
      status: "failure",
      title,
      message: isCLIError(error) ? error.message : "Return to the terminal for details.",
    }),
  );
}
