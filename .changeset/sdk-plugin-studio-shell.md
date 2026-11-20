---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-studio": minor
---

Add `@tailor-platform/sdk-plugin-studio`, a CLI plugin that serves a local web UI shell with `tailor studio`.

The shell opens one port on `127.0.0.1` (default 7777, the next free port when taken) and serves CLI plugin UIs under `/plugins/<id>/`, so plugins no longer need a server and port of their own. For now the shell has one built-in tab, the ERD viewer. It is built with AppShell, the UI base of the Console. Requests are accepted only for the `127.0.0.1` / `localhost` hosts on the shell's port, and any request other than `GET` / `HEAD` must carry the per-run token and a local `Origin`. Requests a browser marks as coming from another site (`Sec-Fetch-Site: cross-site` or `same-site`) are rejected, so a page open in the same browser cannot trigger a tab's work.

A bar at the top of the page shows the selected profile and workspace and switches them for every tab. `@tailor-platform/sdk/cli` also exports `listProfileInfos`, which reads the profiles of the platform configuration.

The default tab is `@tailor-platform/sdk-plugin-tailordb-erd`. When it is not installed the tab shows the install command, and when the installed version does not provide a UI yet the tab says so. `tailor studio` is also added to the install hint that the CLI prints when a plugin executable is missing.
