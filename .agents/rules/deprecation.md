# Deprecating a Public API

Anything reachable from `packages/sdk/package.json#exports` leaves through a cycle: mark it
`@deprecated`, ship a codemod that migrates callers, delete it in the next major. `pnpm
check:deprecations` enforces the mechanical parts.

## Tag format

```ts
/**
 * @deprecated since NEXT_RELEASE — use {@link execJobFunction} instead. codemod: v2/exec-job-function-rename
 */
```

- `since <version>` comes first, and it is the version that **ships the deprecation** — not the
  version the API was introduced in, and not the version that removes it. JSDoc's own `@since` means
  the opposite, so do not carry that reading over.
- Write the literal `NEXT_RELEASE` while that version is undecided, which is the normal case for a
  deprecation you are writing now: the release workflow rewrites it on the release PR (see
  `.github/scripts/resolve-pending-release-versions.sh`). Never guess a future version — a version
  above the current package version is rejected. A concrete version belongs in the tag only when
  back-filling an already-released deprecation, and then it comes from `git log -S '@deprecated'` and
  the CHANGELOG, not from an estimate.
- `codemod: <id>[, <id>]` names entries in `packages/sdk-codemod/src/registry.ts`.
- Name the replacement in the same sentence. This text is what users read in their editor.
- The tag starts its own JSDoc line, which is where JSDoc reads a block tag. When a comment only
  talks _about_ deprecation, write the tag name as inline code (`` `@deprecated` ``) so it is not
  read as one.
- Non-exported code has no deprecation cycle: change it directly instead of tagging it. Any
  `@deprecated` under `packages/sdk/src` must still satisfy the format above.

## The codemod ships with the deprecation, not after it

- Add the registry entry in the same change as the `@deprecated` tag. A migration that cannot be
  automated still gets an entry: omit `scriptPath` and ship `suspiciousPatterns` + `prompt`.
- The entry's `since` / `until` are a version **range**, a different axis from the tag's `since`, which
  is one version. `tailor upgrade` offers a codemod when `since <= from < until <= to`: `since` is the
  oldest source version the deprecated API exists in (`1.0.0` for anything predating the current
  major), and `until` is the version that **removes** it — the boundary a caller must cross to be
  offered the migration.
- Do not put `until` at the deprecating version. A caller already on that version has `from == until`,
  fails `from < until`, and is never offered the migration — including the upgrade to the release that
  removes the API, which is exactly when their code breaks. When the removal version is not decided
  yet, it is the next major, which the cycle below guarantees.
- Use `prereleaseUntil: V2_NEXT_PENDING` while the prerelease that ships it is unknown; the same
  release step resolves it.
- Run `pnpm codemod:docs:update` so the generated migration doc matches the registry.
- Never rewrite user code onto a name that is itself deprecated. When deprecating a name, search the
  registry for codemods whose output produces it and retarget them.

### Worked example

`oldApi` exists in 1.x, 2.1.0 deprecates it, 3.0.0 removes it:

```ts
/** @deprecated since 2.1.0 — use {@link newApi} instead. codemod: v3/old-api-to-new */
export const oldApi = newApi;

// packages/sdk-codemod/src/registry.ts
{ id: "v3/old-api-to-new", since: "1.0.0", until: "3.0.0", ... }
```

| upgrade          | offered | why                                                                        |
| ---------------- | ------- | -------------------------------------------------------------------------- |
| `1.83.0 → 3.0.0` | yes     | crosses the boundary into the release that removed `oldApi`                |
| `2.1.0 → 3.0.0`  | yes     | `until: "2.1.0"` would have excluded this caller and broken it unwarned    |
| `1.83.0 → 2.1.0` | no      | `oldApi` is deprecated but still works; the editor hint is the only signal |

A deprecation that ships and is removed in the same major collapses to a single boundary — the v2
removals use `since: "1.0.0"`, `until: "2.0.0"`, with the tag reading `since 2.0.0`.

## Removal

- Delete the API, its `@deprecated` tag, and any alias in the next major. Deprecated aliases do not
  cross a major boundary.
- Removal is what the codemod exists for: confirm an entry covers the removed API, and add the
  missing coverage in the removal change itself when it does not.
