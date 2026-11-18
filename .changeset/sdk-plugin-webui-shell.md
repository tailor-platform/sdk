---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-webui": minor
---

Add `@tailor-platform/sdk-plugin-webui`, a CLI plugin that serves a local web UI shell with `tailor webui`.

The shell opens one port on `127.0.0.1` (default 7777, the next free port when taken) and serves CLI plugin UIs under `/plugins/<id>/`, so plugins no longer need a server and port of their own. For now the shell has one built-in tab, the ERD viewer. It is built with AppShell, the UI base of the Console. Requests are accepted only for the `127.0.0.1` / `localhost` hosts on the shell's port, and any request other than `GET` / `HEAD` must carry the per-run token and a local `Origin`.

The default tab is `@tailor-platform/sdk-plugin-tailordb-erd`. When it is not installed the tab shows the install command, and when the installed version does not provide a UI yet (as with the current ERD release) the tab says so. `tailor webui` is also added to the install hint that the CLI prints when a plugin executable is missing.
