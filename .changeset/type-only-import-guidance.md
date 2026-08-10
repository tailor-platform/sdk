---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
"@tailor-platform/sdk-codemod": minor
---

Guide users through the v2 type-only import requirement. The CLI loads TypeScript by stripping types from each file in isolation, so a plain import of a type-only export fails at load time with `SyntaxError: ... does not provide an export named '<name>'` and no indication that the import form is the cause.

- The CLI now appends a suggestion to that error: import the name with `import type` and set `"verbatimModuleSyntax": true` in tsconfig.json to catch violations at typecheck.
- Projects scaffolded by `tailor init` now enable `verbatimModuleSyntax` in their tsconfig.json, so new projects cannot hit this at runtime.
- The v2 migration guide gains a `v2/type-only-imports` entry documenting the requirement, the failure mode, and the migration steps, offered by `tailor upgrade` when crossing the v2 boundary.
