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

The server listens on `127.0.0.1` only. It is meant for a machine you use alone: any other user or process on the same machine can reach the port, and what a tab does runs with your stored login. The checks on each request keep other web pages in your browser out; they do not authenticate a client on the same machine. The default tab is the TailorDB ERD viewer from `@tailor-platform/sdk-plugin-tailordb-erd`; without that plugin the tab shows how to install it.

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

The watch belongs to the server, not to the page: it goes on when the page is closed and ends with Stop or when the server stops. It runs against the workspace selected in the bar, and is restarted on the new workspace when that selection changes, or stopped when the selection is cleared, so it never keeps running against a workspace the bar no longer shows. `--function-watch` starts it as soon as the server is up, against the workspace of the profile given by `--profile` (or the one remembered from the last session); without it nothing runs until Run is pressed, because the function runs on that workspace.

### Using it from an AI agent

Start `tailor studio --profile <name> --function-watch`, then edit the function and argument files and read the result file; no browser is needed. In `function.result.json`:

- `status` is `watching`, `stopped` or `idle`, and `reason` says why it stopped (no workspace selected, the selection was cleared, the process ended).
- `running` is `true` from the moment the watch starts or you save a change until the run that follows has reported back, including the extra run the watch starts for a save made while a run was in flight; read the outcome only once it is `false`. The watch reports only when a run ends, so `running` is inferred from when you saved (the time of the file, not the time the server noticed it) and from the watch waiting 100 ms after a save; a change to a file the function imports is not seen by the server, so it does not set `running`.
- `latestRun` is the newest run: `record` holds `success`, `logs`, `result` and `error`, `argErrors` lists the `TailorErrors` items with their `path`, and `at` is when it finished.
- `entries` lists the latest twenty entries, newest first, including notes and failures such as an expired login.
- `inputsChangedAt` is when the server last saw the function or the argument change. After an edit, the outcome is the `latestRun` whose `at` is later than your edit; if `inputsChangedAt` did not move, nothing ran again because the new argument reads the same as the old one.
- `argError` is set while the argument file does not parse; the last valid argument is still the one in use.

A run starts only from a request the shell lets through: one the page makes itself, marked same-origin.

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

const handler: UiHandler = (request, { basePath, getSelection, onSelectionChange }) =>
  new Response("...");
export default handler;
```

- The shell serves the handler under `/plugins/<id>/`. The request URL it receives has that prefix removed, and `basePath` is the prefix. Reference assets and APIs with relative URLs.
- The shell checks every request before it reaches a handler. A request a browser marks `Sec-Fetch-Site: cross-site` or `same-site` is rejected, so another page cannot make the browser call a handler; opening the UI from the address bar, a bookmark or `--open` is unaffected. A request other than `GET` / `HEAD` must be marked `Sec-Fetch-Site: same-origin`, and an `Origin` it carries must be a local one. A browser sets that mark itself, so a page of another site cannot make it write: `fetch` from the plugin's page works without any extra header, and a client that does not set the mark, such as `curl`, is rejected.
- `getSelection()` returns the profile / workspace chosen in the bar, `{ profile?, workspaceId? }`, as of that call. `selectionArgs(getSelection())` turns it into `tailor` options (`--profile=<name> --workspace-id=<id>`) and is empty while nothing is selected, in which case the tab should ask the user to choose one in the bar.
- A `tailor` command a tab starts for the selection must run with `selectionEnv(getSelection())` as its environment. `tailor studio` starts with the startup user's `TAILOR_PLATFORM_TOKEN` and the startup profile's `TAILOR_PLATFORM_URL` and `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`. The CLI prefers the token to `--profile` and uses the platform for what the profile does not store, so without `selectionEnv` a command for another profile runs with the wrong user's credentials or on the wrong platform. While nothing is selected the three are kept.
- `onSelectionChange(listener)` calls `listener` whenever the choice changes, from any open window, and returns the function that stops it. A tab that keeps work running against the selection can stop it there instead of polling `getSelection()`.
- A handler may return a streaming `text/event-stream` response.
- `id` is the tab's route (`/<id>`), so `api`, `plugins` and `assets` are rejected.
- Only `kind: "module"` is supported. `kind: "process"` is reserved for plugins that run as a separate process and is rejected for now.
