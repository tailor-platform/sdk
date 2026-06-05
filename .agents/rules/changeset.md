# Changeset Rules

See [docs/changeset.md](../../docs/changeset.md) for full conventions.

## Level Selection

Ask: **Does this change affect SDK users?**

- `major`: Users must change their code to upgrade (API removal, breaking behavior change)
- `minor`: Users can do something new (new command, new field type, new config option, new API)
- `patch`: Invisible to users (bug fix, refactoring, perf, docs, tests, CI)

Common mistake: new CLI commands, new config options, and new field types are **minor**, not patch.

## Description

Write from the SDK user's perspective. Describe what changed for them, not implementation details.

- Good: `Add decimal field type with optional scale parameter for fixed-point precision`
- Bad: `Refactor schema parser to add decimal Zod schema with regex validation`
