---
"@tailor-platform/sdk": minor
---

Add `tailor function run --async`, which runs the function as an asynchronous job instead of a synchronous run, so the time limit of a synchronous run does not stop it (the Platform still ends a job after 5 minutes). The command registers the function as a temporary resource, starts it, waits for it to finish, prints its logs and result the way a synchronous run does, and removes the resource. `--timeout` limits how long the command waits, not how long the function may run, and `--interval` sets how often it checks. When the wait stops (`--timeout` elapsed, or Ctrl+C), the function keeps running and its resource stays: `tailor function logs <execution ID>` reads the outcome, and `tailor workflow prune` removes the resources of runs that have finished. `--async` cannot be combined with `--watch` or `--name`, and `--timeout` and `--interval` need `--async`.

When a synchronous `function run` is stopped by the Platform's time limit, its error is now followed by the same command line with `--async` added, and `--json` carries it as `suggestion`.
