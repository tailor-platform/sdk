# @tailor-platform/sdk-plugin-studio

Tailor CLI plugin that provides `tailor studio`: a local web UI shell, built with AppShell, that hosts the UIs of other CLI plugins on a single port.

> [!NOTE]
> This package is a **CLI plugin**: it ships an external `tailor-studio` executable that the Tailor CLI dispatches to when you run `tailor studio`. It is a beta feature.

## Installation

```bash
npm install -D @tailor-platform/sdk-plugin-studio
```

## Usage

```bash
# Serve the UI on port 7777 (or the next free port) and print its URL
tailor studio

# Prefer another port and open the browser
tailor studio --port 8080 --open
```

The server listens on `127.0.0.1` only. The default tab is the TailorDB ERD viewer from `@tailor-platform/sdk-plugin-tailordb-erd`; without that plugin the tab shows how to install it.

## Function run tab

The Function run tab runs `tailor function run <file> --watch --json` for a function file in the current project and shows each run as a card: status, execution ID, logs, result and error. Enter the file relative to the project (for example `resolvers/add.ts`) and an optional JSON argument, then press Run and watch. The function runs again when you save the file or a file it imports. Stop, or closing the page, ends the watch.

The tab uses the `@tailor-platform/sdk` installed in the project, and only files inside the project can be run. A run starts only from a request that carries the per-run token the shell hands to the page.

## Mounting a plugin's UI

A plugin that provides a tab declares its UI in `package.json`. The shell currently has one built-in tab, the ERD viewer; discovering the tabs of other plugins is not implemented yet, so this is the contract a plugin's UI has to follow:

```json
{
  "tailorUi": { "id": "my-plugin", "title": "My plugin", "kind": "module", "entry": "./dist/ui.js" }
}
```

`entry` must have a default export of type `UiHandler`, a Web-standard `(request, context) => Response`:

```ts
import type { UiHandler } from "@tailor-platform/sdk-plugin-studio";

const handler: UiHandler = (request, { basePath, token }) => new Response("...");
export default handler;
```

- The shell serves the handler under `/plugins/<id>/`. The request URL it receives has that prefix removed, and `basePath` is the prefix. Reference assets and APIs with relative URLs.
- Requests other than `GET` / `HEAD` are checked by the shell. The plugin's page must send `context.token` in the `x-tailor-studio-token` header.
- Requests a browser marks `Sec-Fetch-Site: cross-site` or `same-site` are rejected, so another page cannot make the browser call a handler. Opening the UI from the address bar, a bookmark or `--open` is unaffected.
- A handler may return a streaming `text/event-stream` response.
- `id` is the tab's route (`/<id>`), so `api`, `plugins` and `assets` are rejected.
- Only `kind: "module"` is supported. `kind: "process"` is reserved for plugins that run as a separate process and is rejected for now.
