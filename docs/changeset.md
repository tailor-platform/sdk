# Changeset Conventions

## Overview

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and release management. Every PR that changes SDK behavior or non-test source in a package listed in [changeset-check.yml](../.github/workflows/changeset-check.yml), including internal refactoring, must include a changeset with the correct version bump level.

```bash
pnpm changeset
```

## Prerelease Codemod Validation

When validating codemod behavior before a prerelease, record the exact runner that produced the result:

- For package-based validation, cite an exact published npm version such as `@tailor-platform/sdk-codemod@0.3.0-next.3`.
- For branch-head validation, build the package locally, run `node packages/sdk-codemod/dist/index.js ...`, and cite the `runner.gitCommit` plus `runner.localBuildCommand` from the JSON summary.
- Do not cite an older npm prerelease for behavior that only exists on the branch head. Publish a new prerelease first, or keep the validation explicitly tied to the branch commit and local build command.

## Version Bump Levels

The key question for choosing a level: **How does this change affect SDK users?**

### `major` — Breaking changes

SDK users must modify their code or configuration to upgrade.

- Removing or renaming a public API (`defineConfig`, `db.table`, `createResolver`, etc.)
- Changing the signature or behavior of an existing API in an incompatible way
- Changing `tailor.config.ts` format in a way that requires migration
- Raising the minimum Node.js version
- Removing a CLI command or changing its default behavior in a way that requires users to update
  scripts, code, or configuration

A CLI behavior change is not automatically breaking. A change that follows a breaking change in an
external system is not an SDK breaking change when it preserves existing SDK invocations, scripts,
code, and configuration. If that distinction cannot be established from the repository, confirm the
expected compatibility with the user before choosing `major`.

#### Breaking changes to beta features

A feature is beta only when it carries the beta mark itself:

- An exported symbol, or a property or method of one: `**Beta:**` in its JSDoc. The members of a
  marked symbol share its mark.
- A CLI command or option: `(beta)` in its description. A command's subcommands and options share
  its mark.
- Behavior with no symbol or command of its own is beta only when listed here: how the CLI dispatches
  `tailor <name>` to a `tailor-<name>` plugin executable and the environment variables it passes, and
  how `tailor deploy` applies pending TailorDB migrations (schema verification, migration phases,
  checkpoints, and scripts), including the `migrate.ts` contract.

Where the docs explain or mention an API does not change this; the `(Beta)` in `packages/sdk/docs/`
only repeats the mark for readers. When a change to a beta API also changes a non-beta one, such as a
beta type that also shapes non-beta command output, the non-beta one decides the level.

A breaking change to a beta feature is `minor`, and its description starts with
`**Breaking change (beta)**:` followed by the user impact and migration steps.

### `minor` — New capabilities

SDK users can do something new that they couldn't before. Their existing code continues to work without changes.
[Breaking changes to beta features](#breaking-changes-to-beta-features) are also `minor`.

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

| Change                            | Wrong | Correct   | Reason                                          |
| --------------------------------- | ----- | --------- | ----------------------------------------------- |
| New CLI command                   | patch | **minor** | Users can do something new                      |
| New config option                 | patch | **minor** | Users can configure something new               |
| New field type                    | patch | **minor** | Users can define new schemas                    |
| Internal refactoring              | minor | **patch** | Invisible to users                              |
| Performance improvement           | minor | **patch** | Same behavior, just faster                      |
| Better validation error           | minor | **patch** | Existing behavior improved, not new capability  |
| Breaking change to a beta feature | major | **minor** | Beta features can break outside a major release |

## When No Changeset Is Needed

Add the `skip-changeset` label to your PR when:

- Documentation-only changes (README, docs/, AGENTS.md)
- CI/CD configuration changes (.github/workflows/)
- Development tooling changes (eslint, lefthook, etc.)
- Test-only changes with no source code modifications

Internal refactoring of non-test source in a package listed in [changeset-check.yml](../.github/workflows/changeset-check.yml) still needs a `patch` changeset, even with no observable behavior change; do not use `skip-changeset` for it.

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
