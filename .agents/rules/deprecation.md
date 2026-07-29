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
  back-filling an already-released deprecation, and then it is looked up the same way — with the same
  limits — as the registry `since` below, never estimated.
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
  is one version. `tailor upgrade` offers a codemod when `since <= from < until <= to`: `since` bounds
  the caller's current version and `until` is the boundary they must cross to be offered the migration.
- `until` is the **next major**, `<current major + 1>.0.0`. That is not a convention to weigh but where
  the removal has to land: removing or renaming a public API is a `major` changeset (see
  [docs/changeset.md](../../docs/changeset.md)), so the release that drops the API is the only boundary
  worth pointing at. Every entry in the registry today reads `until: "2.0.0"`. On a prerelease line the
  stable major stays in `until` and the `2.0.0-next.N` goes in `prereleaseUntil` — a `-next` version in
  `until` is rejected. A codemod that only modernizes call sites without removing anything is outside
  this cycle and may sit at a minor.
- `since` is the version that **introduced** the API being migrated away from, not the version that
  deprecated it. `--from` is whatever the caller passes, so a project can jump several majors in one
  run; a `since` set at the deprecating version drops every caller older than it, and their code breaks
  at the removal with nothing offered.
- Establish that version — do not reach for the major's floor because looking it up is work. The
  authoritative source is the published package itself, which no rename or missing release note can
  distort: ask each candidate version whether it exported the symbol, and bisect.

  ```sh
  npm pack @tailor-platform/sdk@<version> --pack-destination "$dir"   # then:
  tar -xzOf "$dir"/*.tgz | grep -c '<symbol>'                        # 0 = absent in that release
  npm view @tailor-platform/sdk versions --json                       # the list to bisect over
  ```

  Confirm a hit lands in `package/dist/**/*.d.mts` rather than an internal chunk, so a symbol that was
  only ever internal is not read as public. About eight probes cover the 140 published 1.x versions.

- The textual shortcuts are worth trying first, but only as candidates the probe then confirms:
  - the release note naming the API in `packages/sdk/CHANGELOG.md` — the oldest mention's `##` heading
  - `git log -S '<symbol>' --format=%h | tail -1`, with **no pathspec** (history is not followed across
    renames, so `-- packages/sdk/src` dates `loadAccessToken` to `chore: rename tailor-sdk to sdk`
    rather than the feature two weeks earlier), reading that commit's diff to check the symbol was
    added rather than moved.

  Both fail quietly. For `kyselyTypePlugin` the CHANGELOG never names it and the pickaxe lands on a
  2026-02 refactor, while the published tarballs show it absent in 1.10.0 and present in 1.20.0.

- Only once the probe cannot settle it — no published artifact covers the range, or the symbol never
  reached `dist` — fall back to `1.0.0`, and say in the PR what was tried. Erring low costs a no-op
  transform; erring high drops callers who break at the removal, which is why the floor is the
  fallback and never the shortcut.

- The tempting mistake is `until` at the deprecating version. A caller already on it has
  `from == until`, fails `from < until`, and is never offered the migration — including the upgrade to
  the release that removes the API, which is exactly when their code breaks.
- Use `prereleaseUntil: V2_NEXT_PENDING` while the prerelease that ships it is unknown; the same
  release step resolves it.
- Run `pnpm codemod:docs:update` so the generated migration doc matches the registry.
- Never rewrite user code onto a name that is itself deprecated. When deprecating a name, search the
  registry for codemods whose output produces it and retarget them.

### Worked example

`oldApi` arrives in 1.40.0, 2.1.0 deprecates it, 3.0.0 removes it:

```ts
/** @deprecated since 2.1.0 — use {@link newApi} instead. codemod: v3/old-api-to-new */
export const oldApi = newApi;

// packages/sdk-codemod/src/registry.ts
{ id: "v3/old-api-to-new", since: "1.40.0", until: "3.0.0", ... }
```

| upgrade          | offered | why                                                                        |
| ---------------- | ------- | -------------------------------------------------------------------------- |
| `1.83.0 → 3.0.0` | yes     | crosses the boundary into the release that removed `oldApi`                |
| `2.1.0 → 3.0.0`  | yes     | `until: "2.1.0"` would have excluded this caller and broken it unwarned    |
| `1.83.0 → 2.1.0` | no      | `oldApi` is deprecated but still works; the editor hint is the only signal |
| `1.20.0 → 3.0.0` | no      | predates `oldApi`, so there is no reference to rewrite                     |

Both bounds are read off the API's own life: `since` where it appeared, `until` where it disappears.
`since: "1.40.0"` is writable here because the release that introduced `oldApi` was established;
`1.0.0` would keep the first three rows and merely list the codemod for the 1.20.0 caller too, which is
what makes it a safe fallback rather than a good answer. Moving `since` up to `2.0.0` or `2.1.0` is the
one direction that is wrong outright — it drops the `1.83.0 → 3.0.0` caller and breaks them at the
removal.

A deprecation that ships and is removed in the same major collapses to a single boundary — the v2
removals use `since: "1.0.0"`, `until: "2.0.0"`, with the tag reading `since 2.0.0`.

## Removal

- Delete the API, its `@deprecated` tag, and any alias in the next major. Deprecated aliases do not
  cross a major boundary.
- Removal is what the codemod exists for: confirm an entry covers the removed API, and add the
  missing coverage in the removal change itself when it does not.
- Forgetting the removal is a check failure, not a discovery two releases later. `check:deprecations`
  rejects a `@deprecated` declaration once the current version reaches its codemod's boundary, so the
  release PR that bumps to the next major fails while the declaration is still there — the release PR
  runs the same CI, and its version bump is what trips the rule. This is the drift the v2 plugin
  re-exports lived in: `v2/plugin-cli-import` shipped in `2.0.0-next.1` and the aliases stayed until
  they were deleted by hand.
