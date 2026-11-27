# @tailor-platform/sdk-plugin-function-ui

Tailor CLI plugin that provides `tailor function ui`: a page in your browser for running a function against a workspace. Edit the function and its argument, and each run shows up as a card with its status, execution ID, logs, result and error.

> [!NOTE]
> This package is a **CLI plugin**: it ships an external `tailor-function-ui` executable that the Tailor CLI dispatches to when you run `tailor function ui`. It is a beta feature.

## Installation

```bash
npm install -D @tailor-platform/sdk-plugin-function-ui
```

## Usage

```bash
# Edit a scratch function at .tailor/studio/function.ts, run on the workspace of a profile
tailor function ui --profile my-profile --open

# Edit an existing function and start watching right away
tailor function ui resolvers/add.ts --profile my-profile --watch
```

The server listens on `127.0.0.1` only, on port 7778 or the next free port (`--port`). It is meant for a machine you use alone: any other user or process on the same machine can reach the port, and a run uses your stored login. The checks on each request keep other web pages in your browser out; they do not authenticate a client on the same machine. `--profile` and `--workspace-id` can also be given as `TAILOR_PLATFORM_PROFILE` and `TAILOR_PLATFORM_WORKSPACE_ID`. It is also the Function run tab of `tailor studio`, which shows the same page next to the other tabs.

## Function run

Function run runs a function the way `tailor function run --watch` does, inside the server in a worker thread, and shows each run as a card: status, execution ID, logs, result and error. Pass the workspace with `--profile` (or `--workspace-id`), then press Run and watch.

The function and its argument live in files, so the page, your own editor and an AI agent can all change them, and a change made from outside shows up in the page:

| File (in the project)                 | What it holds                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `.tailor/studio/function.ts`          | The function. Created with a small resolver when it is missing.                         |
| `.tailor/studio/function.arg.json5`   | Its argument, as JSON5 (keys without quotes, single quotes, trailing commas, comments). |
| `.tailor/studio/function.result.json` | What the watch is doing and what the last runs returned, for an agent to read.          |

The file argument edits an existing file instead, for example `resolvers/add.ts`; the argument and result files are then `.tailor/studio/<name>.arg.json5` and `.tailor/studio/<name>.result.json`, and your file is only ever written when you type in the page. The function is run from its real path, so it imports project files with relative paths. `.tailor/` is where the SDK keeps its build output, and the projects of this repository ignore it.

The function runs again each time the file changes, and the argument can be edited while watching. Code typed in the page that formats to the same as before (only spaces or line breaks differ) is not written, so it does not run again. An argument that does not parse is ignored until it does. When a run fails with a `TailorErrors` (an argument that does not match the input schema), the argument box turns red and the value each error points at is underlined, with the message on hover.

The watch runs in a worker thread, so project code that calls `process.exit()` while it loads ends the watch (the page shows that it ended) and not the server. It belongs to the server, not to the page: it goes on when the page is closed and ends with Stop or when the server stops. It runs against the workspace given with `--profile` (or `--workspace-id`), which for a profile is the workspace the profile points to when the watch starts. `--watch` starts it as soon as the server is up; without it nothing runs until Run is pressed, because the function runs on that workspace.

## Using it from an AI agent

Start `tailor function ui --profile <name> --watch`, then edit the function and argument files and read the result file; no browser is needed. In `function.result.json`:

- `status` is `watching`, `stopped` or `idle`, and `reason` says why it stopped (no workspace selected, the selection was cleared, the watch ended).
- `running` is `true` from the moment the watch starts or a file the watch follows changes until the run that follows has reported back, including the extra run the watch starts for a save made while a run was in flight; read the outcome only once it is `false`. The watch tells the server when it begins a run, when a run is queued behind one in flight, and when a run ends, so `running` follows the watch itself, including a change to a file the function imports.
- `latestRun` is the newest run: `record` holds `success`, `logs`, `result` and `error`, `argErrors` lists the `TailorErrors` items with their `path`, and `at` is when it finished.
- `entries` lists the latest twenty entries, newest first, including notes and failures such as an expired login.
- `inputsChangedAt` is when the server last saw the function or the argument change. After an edit, the outcome is the `latestRun` whose `at` is later than your edit; if `inputsChangedAt` did not move, nothing ran again because the new argument reads the same as the old one.
- `argError` is set while the argument file does not parse; the last valid argument is still the one in use.

A run starts only from a request the server lets through: one the page makes itself, marked same-origin.
