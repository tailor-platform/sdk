---
"@tailor-platform/sdk-codemod": patch
---

Make the deprecation process mechanical: an `@deprecated` tag in the SDK now states the version it shipped in and the codemod that migrates callers off it (`@deprecated since 2.1.0 — use {@link newApi} instead. codemod: v2/old-to-new`), and `pnpm check:deprecations` fails when a tag misses either half or names a codemod that is not registered. While the shipping version is still undecided the tag carries the literal `NEXT_RELEASE`, which the release workflow rewrites to the version the release PR bumps to — the same step that already resolves `prereleaseUntil: V2_NEXT_PENDING` codemod boundaries.
