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

## Function run tab

The Function run tab runs a function with `tailor function run --watch --json` and shows each run as a card: status, execution ID, logs, result and error. Pick the workspace in the bar at the top, then press Run and watch.

The function and its argument live in files, so the page, your own editor and an AI agent can all change them, and a change made from outside shows up in the page:

| File (in the project)                 | What it holds                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `.tailor/studio/function.ts`          | The function. Created with a small resolver when it is missing.                         |
| `.tailor/studio/function.arg.json5`   | Its argument, as JSON5 (keys without quotes, single quotes, trailing commas, comments). |
| `.tailor/studio/function.result.json` | What the watch is doing and what the last runs returned, for an agent to read.          |

`--function-file <path>` edits an existing file instead, for example `resolvers/add.ts`; the argument and result files are then `.tailor/studio/<name>.arg.json5` and `.tailor/studio/<name>.result.json`, and your file is only ever written when you type in the page. The function is run from its real path, so it imports project files with relative paths. `.tailor/` is where the SDK keeps its build output, and the projects of this repository ignore it.

The function runs again each time the file changes, and the argument can be edited while watching. Code typed in the page that formats to the same as before (only spaces or line breaks differ) is not written, so it does not run again. An argument that does not parse is ignored until it does. When a run fails with a `TailorErrors` (an argument that does not match the input schema), the argument box turns red and the value each error points at is underlined, with the message on hover.

The watch belongs to the server, not to the page: it goes on when the page is closed and ends with Stop or when the server stops. It runs against the workspace selected in the bar, and is stopped when that selection changes, so it never keeps running against a workspace the bar no longer shows. `--function-watch` starts it as soon as the server is up, against the workspace given by `--profile` or `--workspace-id`; without it nothing runs until Run is pressed, because the function runs on that workspace.

### Using it from an AI agent

Start `tailor studio --profile <name> --function-watch`, then edit the function and argument files and read the result file; no browser is needed. In `function.result.json`:

- `status` is `watching`, `stopped` or `idle`, and `reason` says why it stopped (no workspace selected, the workspace changed, the process ended).
- `latestRun` is the newest run: `record` holds `success`, `logs`, `result` and `error`, `argErrors` lists the `TailorErrors` items with their `path`, and `at` is when it finished.
- `entries` lists the latest twenty entries, newest first, including notes and failures such as an expired login.
- `inputsChangedAt` is when the server last saw the function or the argument change. After an edit, the outcome is the `latestRun` whose `at` is later than your edit; if `inputsChangedAt` did not move, nothing ran again because the new argument reads the same as the old one.
- `argError` is set while the argument file does not parse; the last valid argument is still the one in use.

A run starts only from a request that carries the per-run token the shell hands to the page.

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
