import { createHttpAdapter } from "@tailor-platform/sdk";
import ml from "multiline-ts";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const str =
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : JSON.stringify(v);
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default createHttpAdapter({
  name: "people-page",
  pathPattern: "/people",
  input: {
    get: () => ({
      query: ml /* gql */ `
        query {
          users(first: 20, order: [{ field: name, direction: Asc }]) {
            edges {
              node {
                id
                name
                email
                role
                status
              }
            }
          }
        }`,
    }),
  },
  output: (resp) => {
    const data = resp.data as
      | { users?: { edges?: { node: Record<string, unknown> }[] } }
      | null
      | undefined;
    const edges = data?.users?.edges ?? [];
    const rows =
      edges
        .map(
          ({ node: u }) =>
            `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>` +
            `<td>${esc(u.role)}</td><td>${esc(u.status)}</td></tr>`,
        )
        .join("") || `<tr><td colspan="4">該当なし</td></tr>`;
    return {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: ml /* html */ `
        <!doctype html>
        <html lang="ja">
          <head>
            <meta charset="utf-8">
            <title>People</title>
            <link rel="icon" type="image/svg+xml" href="/api/favicon.svg">
            <script src="https://unpkg.com/htmx.org@2.0.4" integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+" crossorigin="anonymous"></script>
            <style>
              body {
                font-family:system-ui;
                margin:3rem;
                max-width:680px;
              }
              input {
                font-size:1rem;
                padding:.5rem;
                width:100%;
                box-sizing:border-box;
              }
              table {
                border-collapse:collapse;
                width:100%;
                margin-top:1rem;
              }
              th, td {
                border:1px solid #ddd;
                padding:.5rem .75rem;
                text-align:left;
              }
              .htmx-indicator {
                opacity:0;
                transition:opacity .2s;
              }
              .htmx-request .htmx-indicator {
                opacity:1;
              }
            </style>
          </head>
          <body>
            <h1>People <span id="spin" class="htmx-indicator">検索中…</span></h1>
            <input
              type="search"
              name="q" placeholder="名前で検索…"
              autofocus
              hx-get="/api/people-rows"
              hx-trigger="keyup changed delay:300ms, search"
              hx-target="#rows"
              hx-indicator="#spin"
            >
            <table>
              <thead>
                <tr>
                  <th>name</th><th>email</th><th>role</th><th>status</th>
                </tr>
              </thead>
              <tbody id="rows">${rows}</tbody>
            </table>
          </body>
        </html>`,
    };
  },
});
