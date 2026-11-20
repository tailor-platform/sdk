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

## Workspace

The bar at the top of the page shows the profile and workspace every tab works against, and switches it. The profiles are the ones of `tailor profile list`. `--profile` / `--workspace-id` (or `TAILOR_PLATFORM_PROFILE` / `TAILOR_PLATFORM_WORKSPACE_ID`) give the first selection. The bar turns amber while nothing is selected.

## Function run tab

The Function run tab runs code you write in its editor with `tailor function run --watch --json` and shows each run as a card: status, execution ID, logs, result and error. Pick the workspace in the bar at the top first; Run stays refused until one is selected. Write the function, add an optional JSON argument, then press Run and watch. The function runs again a moment after you stop typing, unless the code formats to the same as before (a change of spaces or line breaks alone does not run it again). The argument can be edited while watching and runs the function again with the new argument; the argument is a small editor and may be written as JSON5 (keys without quotes, single quotes, trailing commas, comments), and one that does not parse is ignored until it does. When a run fails with a `TailorErrors` (an argument that does not match the input schema), the argument box turns red and the value each error points at is underlined, with the message on hover. Stop, or closing the page, ends the watch.

The code is saved to a temporary file outside the project, so it is not part of your project and the file is removed when the run ends. Packages installed in the project (such as `@tailor-platform/sdk`) can be imported; use absolute paths to import other project files. The tab uses the `@tailor-platform/sdk` installed in the project. A run starts only from a request that carries the per-run token the shell hands to the page.

## Mounting a plugin's UI

A plugin that provides a tab declares its UI in `package.json`. The shell currently has two built-in tabs, the ERD viewer and Function run; discovering the tabs of other plugins is not implemented yet, so this is the contract a plugin's UI has to follow:

```json
{
  "tailorUi": { "id": "my-plugin", "title": "My plugin", "kind": "module", "entry": "./dist/ui.js" }
}
```

`entry` must have a default export of type `UiHandler`, a Web-standard `(request, context) => Response`:

```ts
import { selectionArgs, type UiHandler } from "@tailor-platform/sdk-plugin-studio";

const handler: UiHandler = (request, { basePath, token, getSelection }) => new Response("...");
export default handler;
```

- The shell serves the handler under `/plugins/<id>/`. The request URL it receives has that prefix removed, and `basePath` is the prefix. Reference assets and APIs with relative URLs.
- Requests other than `GET` / `HEAD` are checked by the shell. The plugin's page must send `context.token` in the `x-tailor-studio-token` header.
- Requests a browser marks `Sec-Fetch-Site: cross-site` or `same-site` are rejected, so another page cannot make the browser call a handler. Opening the UI from the address bar, a bookmark or `--open` is unaffected.
- `getSelection()` returns the profile / workspace chosen in the bar, `{ profile?, workspaceId? }`, as of that call. `selectionArgs(getSelection())` turns it into `tailor` options (`-p <profile> -w <id>`) and is empty while nothing is selected, in which case the tab should ask the user to choose one in the bar.
- A handler may return a streaming `text/event-stream` response.
- `id` is the tab's route (`/<id>`), so `api`, `plugins` and `assets` are rejected.
- Only `kind: "module"` is supported. `kind: "process"` is reserved for plugins that run as a separate process and is rejected for now.
