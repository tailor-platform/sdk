---
"@tailor-platform/sdk-codemod": patch
---

Make the deprecation process mechanical: an `@deprecated` tag in the SDK now states the version it shipped in and the codemod that migrates callers off it (`@deprecated since 2.1.0 — use {@link newApi} instead. codemod: v2/old-to-new`), and `pnpm check:deprecations` fails when a tag misses either half, names a codemod that is not registered, or outlives its codemod's boundary — so the release PR that bumps to a major turns red while an API due for removal is still declared, instead of the alias shipping and being noticed releases later. While the shipping version is still undecided the tag carries the literal `NEXT_RELEASE`, which the release workflow rewrites to the version the release PR bumps to — the same step that already resolves `prereleaseUntil: V2_NEXT_PENDING` codemod boundaries.

Registered codemods are validated more strictly too: a `since` that is not valid semver, or that is not older than `until`, now fails fast instead of surfacing as a semver error partway through `tailor upgrade` or as a codemod whose empty version range silently matches nothing.
