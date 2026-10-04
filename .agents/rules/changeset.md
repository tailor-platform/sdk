# Changeset Rules

See [docs/changeset.md](../../docs/changeset.md) for full conventions.

## Level Selection

Ask: **Does this change affect SDK users?**

- `major`: Users must change their code, configuration, or automation to upgrade (API removal,
  incompatible behavior change)
- `minor`: Users can do something new (new command, new field type, new config option, new API)
- `patch`: Invisible to users (bug fix, refactoring, perf, docs, tests, CI)

Common mistake: new CLI commands, new config options, and new field types are **minor**, not patch.
Do not classify every CLI default change as major. A change that follows a breaking change in an
external system is not an SDK breaking change when existing SDK usage continues to work. If that
distinction is unclear, confirm the expected compatibility with the user before choosing `major`.

## Description

Write from the SDK user's perspective. Describe what changed for them, not implementation details.

- Good: `Add decimal field type with optional scale parameter for fixed-point precision`
- Bad: `Refactor schema parser to add decimal Zod schema with regex validation`
