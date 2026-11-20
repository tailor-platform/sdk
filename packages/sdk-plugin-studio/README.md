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

## Profile

The header at the top of the page shows the profile (and the workspace it points to) that every tab works against, and switches it. The profiles are the ones of `tailor profile list`. `--profile` (or `TAILOR_PLATFORM_PROFILE`) gives the first selection; a profile that does not exist stops the start. The "New profile" button next to the selector creates a profile (name, a user logged in with `tailor login`, a workspace that user can see, and read/write permission) and selects it. The platform is the one the environment names when `tailor studio` starts (`TAILOR_PLATFORM_URL`, `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`, `TAILOR_PLATFORM_CONSOLE_URL`): only users logged in on it are offered, their workspaces are read from it, and the new profile stores it. When the environment changes any of them, the header shows a `platform: <URL>` badge (hover for all the values) and the New profile dialog lists them. The choice is remembered per project in `node_modules/.cache/tailor-studio/`, so the next `tailor studio` in the same project starts with it (`--profile` wins when given). The header turns gray while no profile is selected.

## Mounting a plugin's UI

A plugin that provides a tab declares its UI in `package.json`. The shell currently has one built-in tab, the ERD viewer; discovering the tabs of other plugins is not implemented yet, so this is the contract a plugin's UI has to follow:

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
- `getSelection()` returns the profile / workspace chosen in the bar, `{ profile?, workspaceId? }`, as of that call. `selectionArgs(getSelection())` turns it into `tailor` options (`--profile=<name> --workspace-id=<id>`) and is empty while nothing is selected, in which case the tab should ask the user to choose one in the bar.
- A handler may return a streaming `text/event-stream` response.
- `id` is the tab's route (`/<id>`), so `api`, `plugins` and `assets` are rejected.
- Only `kind: "module"` is supported. `kind: "process"` is reserved for plugins that run as a separate process and is rejected for now.
