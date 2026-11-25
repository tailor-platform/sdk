---
"@tailor-platform/sdk": minor
---

`@tailor-platform/sdk/cli` exports the beta `runFunctionWatch()`, which runs a function on the Platform now and again each time the function file, a project file it imports, or the argument file changes, as `tailor function run --watch` does. It reports to an `onEvent` callback instead of printing: `ready`, `scheduled` (a watched file changed), `queued` (a change arrived during a run, so one more run follows), `started`, then `finished` with the record `--json` writes, or `failed` with its error envelope. It does not handle SIGINT, SIGTERM, or SIGHUP, so the program that hosts the watch decides how to stop it. `tailor function run` prints exactly what it printed before.
