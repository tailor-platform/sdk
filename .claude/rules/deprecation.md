---
paths:
  - "packages/sdk/src/**/*.ts"
  - "packages/sdk-codemod/src/registry.ts"
---

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

- `since <version>` comes first. Write the literal `NEXT_RELEASE` while the version that ships the
  deprecation is undecided; the release workflow rewrites it on the release PR (see
  `.github/scripts/resolve-pending-release-versions.sh`). Never guess a future version — a version
  above the current package version is rejected.
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
- Use `prereleaseUntil: V2_NEXT_PENDING` while the prerelease that ships it is unknown; the same
  release step resolves it.
- Run `pnpm codemod:docs:update` so the generated migration doc matches the registry.
- Never rewrite user code onto a name that is itself deprecated. When deprecating a name, search the
  registry for codemods whose output produces it and retarget them.

## Removal

- Delete the API, its `@deprecated` tag, and any alias in the next major. Deprecated aliases do not
  cross a major boundary.
- Removal is what the codemod exists for: confirm an entry covers the removed API, and add the
  missing coverage in the removal change itself when it does not.
