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
  the caller's current version and `until` is the version that **removes** the API — the boundary a
  caller must cross to be offered the migration.
- `since` is the version that **introduced** the API being migrated away from, not the version that
  deprecated it. `--from` is whatever the caller passes, so a project can jump several majors in one
  run; a `since` set at the deprecating version drops every caller older than it, and their code breaks
  at the removal with nothing offered.
- Getting `since` wrong is not symmetric, so let that decide the default. Too low only lists the
  codemod for a project that cannot match it — a no-op transform. Too high drops callers whose code
  breaks at the removal, silently. So `since` is `1.0.0` unless the introduction version is
  **established**; tighten it only against evidence, never against a recollection.
- Two things can serve as that evidence, and neither is conclusive on its own:
  - the release note naming the API in `packages/sdk/CHANGELOG.md` — the oldest mention's `##` heading
  - `git log -S '<symbol>' --format=%h | tail -1`, whose commit should sit in that same release

  Do not add a pathspec to that command. History is not followed across renames, so
  `-- packages/sdk/src` reports a directory restructure as the introduction: it dates
  `loadAccessToken` to `chore: rename tailor-sdk to sdk` rather than the feature two weeks earlier.

- Treat the version as not established — and stay at `1.0.0` — when the two disagree, when the commit
  is a merge or squash whose sha is not in the CHANGELOG, or when no release note names the API at all
  (`kyselyTypePlugin`, an exported plugin, is never mentioned in the CHANGELOG). `since` is
  machine-checked only for being valid semver and older than `until`; which version it names is a
  judgement, so record the evidence in the PR whenever it is not `1.0.0`.

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
`since: "1.40.0"` is only writable here because the release that introduced `oldApi` is established;
falling back to `1.0.0` keeps the first three rows and merely lists the codemod for the 1.20.0 caller
too. Moving `since` up to `2.0.0` or `2.1.0` is the one direction that is wrong outright — it drops the
`1.83.0 → 3.0.0` caller and breaks them at the removal. The v2 entries use `since: "1.0.0"` because
those APIs do span the whole 1.x line.

A deprecation that ships and is removed in the same major collapses to a single boundary — the v2
removals use `since: "1.0.0"`, `until: "2.0.0"`, with the tag reading `since 2.0.0`.

## Removal

- Delete the API, its `@deprecated` tag, and any alias in the next major. Deprecated aliases do not
  cross a major boundary.
- Removal is what the codemod exists for: confirm an entry covers the removed API, and add the
  missing coverage in the removal change itself when it does not.
