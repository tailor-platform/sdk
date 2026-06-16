---
"@tailor-platform/sdk-codemod": minor
---

Add the `v2/plugin-cli-import` codemod so `tailor-sdk upgrade` rewrites deprecated plugin imports from `@tailor-platform/sdk/cli` (`kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, `seedPlugin`) to their dedicated `@tailor-platform/sdk/plugin/*` subpaths, splitting any non-plugin specifiers onto a separate import.
