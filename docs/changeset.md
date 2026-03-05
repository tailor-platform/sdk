# Changeset Conventions

## Overview

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and release management. Every PR that changes SDK behavior must include a changeset with the correct version bump level.

```bash
pnpm changeset
```

## Version Bump Levels

The key question for choosing a level: **How does this change affect SDK users?**

### `major` — Breaking changes

SDK users must modify their code or configuration to upgrade.

- Removing or renaming a public API (`defineConfig`, `db.type`, `createResolver`, etc.)
- Changing the signature or behavior of an existing API in an incompatible way
- Changing `tailor.config.ts` format in a way that requires migration
- Raising the minimum Node.js version
- Removing a CLI command or changing its default behavior

### `minor` — New capabilities

SDK users can do something new that they couldn't before. Their existing code continues to work without changes.

- New CLI command (e.g., `function logs`, `executor list`, `completion`)
- New field type (e.g., `t.decimal()`, `db.decimal()`)
- New configuration option (e.g., `inlineSourcemap` in `defineConfig`, `gqlOperations` in TailorDB)
- New permission operator (e.g., `hasAny` / `not hasAny`)
- New API export (e.g., new test utilities, new Kysely types)
- New plugin hooks or capabilities

### `patch` — Invisible to users

SDK users don't need to know about this change. Their code works exactly the same.

- Bug fixes
- Internal refactoring (directory restructure, code cleanup, deduplication)
- Performance improvements (parallelization, caching)
- Better error messages
- Documentation changes
- CI/CD changes
- Test additions or improvements
- Dependency updates (unless they change user-facing behavior)

## Common Mistakes

| Change                  | Wrong | Correct   | Reason                                         |
| ----------------------- | ----- | --------- | ---------------------------------------------- |
| New CLI command         | patch | **minor** | Users can do something new                     |
| New config option       | patch | **minor** | Users can configure something new              |
| New field type          | patch | **minor** | Users can define new schemas                   |
| Internal refactoring    | minor | **patch** | Invisible to users                             |
| Performance improvement | minor | **patch** | Same behavior, just faster                     |
| Better validation error | minor | **patch** | Existing behavior improved, not new capability |

## When No Changeset Is Needed

Add the `skip-changeset` label to your PR when:

- Documentation-only changes (README, docs/, CLAUDE.md)
- CI/CD configuration changes (.github/workflows/)
- Development tooling changes (eslint, lefthook, etc.)
- Test-only changes with no source code modifications

## Writing the Description

Write from the SDK user's perspective. Focus on what changed for them, not the implementation details.

**Good:**

```
Add `decimal` field type with optional scale parameter (0-12) for fixed-point precision
```

**Bad:**

```
Refactor TailorDB schema parser to add decimal Zod schema with regex validation and update proto manifests to include scale field in FieldDescriptor
```

For `patch` changes, briefly describe the fix or improvement:

```
Fix bundle cache invalidation when lockfile is removed
```
