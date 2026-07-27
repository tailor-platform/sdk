---
"@tailor-platform/sdk-codemod": minor
---

The `v2/seed-exec-to-cli-plugin` migration now rewrites generated seed runner invocations automatically. `node <distPath>/exec.mjs [options] [types...]` becomes `tailor seed apply [options] [types...]` and `node <distPath>/exec.mjs validate` becomes `tailor seed validate`, in package.json scripts, shell scripts, CI configs, docs, and TypeScript sources, carrying node's `--env-file` / `--env-file-if-exists` flags over to the CLI flag form. Files that `fork()` the runner are left untouched and reported with their exact line, because replacing the forked child with a CLI call also unwinds the surrounding `await`/Promise plumbing; the migration prompt now covers that rewrite and the stale `exec.mjs` deletion.
