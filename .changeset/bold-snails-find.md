---
"@tailor-platform/sdk": patch
"@tailor-platform/sdk-codemod": minor
---

The warnings shown when `files` patterns or the tsconfig fall back to the directory you ran the command from no longer say the fallback is removed before v2: both fallbacks are removed in v3. `tailor upgrade` to v3 runs the `v3/files-config-relative` codemod, which rewrites the string-literal `files` and `ignores` patterns of a config outside the project directory it runs on (`--path`, the current directory by default) when they match files only from that project directory, so that they name the same files relative to the config's directory. It reports configs it cannot rewrite for review, and prints a notice for the tsconfig fallback.
