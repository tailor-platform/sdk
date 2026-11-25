---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-studio": minor
---

Add `@tailor-platform/sdk-plugin-studio`, a CLI plugin that serves a local web UI shell with `tailor studio`.

The shell opens one port on `127.0.0.1` (default 7777, the next free port when taken) and serves CLI plugin UIs under `/plugins/<id>/`, so plugins no longer need a server and port of their own. For now the shell has one built-in tab, the ERD viewer. It is built with AppShell, the UI base of the Console. Requests are accepted only for the `127.0.0.1` / `localhost` hosts on the shell's port, and any request other than `GET` / `HEAD` must be marked `Sec-Fetch-Site: same-origin`, a mark a browser sets itself, and an `Origin` it carries must be a local one. Requests a browser marks as coming from another site (`cross-site` or `same-site`) are rejected, so a page open in the same browser cannot trigger a tab's work. The server does not authenticate clients on the same machine, so it is meant for a machine used by one person.

A bar at the top of the page shows the selected profile and workspace and switches them for every tab; when the choice is changed in one browser window, the bar of every other open window follows. The choice is remembered per project. The bar also creates profiles. `@tailor-platform/sdk/cli` exports `listProfileInfos` (the profiles of the platform configuration), `createProfile` (what `tailor profile create` runs), `listLoggedInUsers` and `listWorkspacesOfUser` for it, and `platformConfigFromEnv`, which returns the settings of `TAILOR_PLATFORM_URL` and its siblings that differ from the default platform. The platform is taken from the environment when `tailor studio` starts.

The default tab is `@tailor-platform/sdk-plugin-tailordb-erd`. When it is not installed the tab shows the install command, and when the installed version does not provide a UI yet the tab says so. `tailor studio` is also added to the install hint that the CLI prints when a plugin executable is missing.
