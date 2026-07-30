---
"@tailor-platform/sdk-codemod": minor
---

The `v2/seed-exec-to-cli-plugin` migration now rewrites generated seed runner invocations automatically. `node <distPath>/exec.mjs [options] [types...]` becomes `tailor seed apply [options] [types...]` and `node <distPath>/exec.mjs validate` becomes `tailor seed validate`, in package.json scripts, shell scripts, CI configs, docs, and TypeScript sources, carrying node's `--env-file` / `--env-file-if-exists` over to the CLI flag form in both the `=` and space-separated spellings. Each invocation must sit on one line, so a command split across YAML sequence items or markdown bullets is reported for review rather than rewritten. Files that `fork()` the runner are left untouched and reported with their exact line, because replacing the forked child with a CLI call also unwinds the surrounding `await`/Promise plumbing; the migration prompt now covers that rewrite and the stale `exec.mjs` deletion.
