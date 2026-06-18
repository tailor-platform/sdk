import { createHttpAdapter } from "@tailor-platform/sdk";
import ml from "multiline-ts";

export default createHttpAdapter({
  name: "people-page",
  pathPattern: "/people",
  input: {
    get: () => ({ query: `query { users(first: 1) { edges { node { id } } } }` }),
  },
  output: () => ({
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: /* html */ ml`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>People</title>
<link rel="icon" type="image/svg+xml" href="/api/favicon.svg">
<script src="https://unpkg.com/htmx.org@2.0.4" integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+" crossorigin="anonymous"></script>
<style>body{font-family:system-ui;margin:3rem;max-width:680px}
input{font-size:1rem;padding:.5rem;width:100%;box-sizing:border-box}
table{border-collapse:collapse;width:100%;margin-top:1rem}
th,td{border:1px solid #ddd;padding:.5rem .75rem;text-align:left}
.htmx-indicator{opacity:0;transition:opacity .2s}.htmx-request .htmx-indicator{opacity:1}</style>
</head><body>
<h1>People <span id="spin" class="htmx-indicator">検索中…</span></h1>
<input type="search" name="q" placeholder="名前で検索…" autofocus
  hx-get="/api/people-rows" hx-trigger="keyup changed delay:300ms, search"
  hx-target="#rows" hx-indicator="#spin">
<table><thead><tr><th>name</th><th>email</th><th>role</th><th>status</th></tr></thead>
<tbody id="rows" hx-get="/api/people-rows" hx-trigger="load"></tbody></table>
</body></html>`,
  }),
});
