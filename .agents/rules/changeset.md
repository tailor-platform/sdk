# Changeset Rules

See [docs/changeset.md](../../docs/changeset.md) for full conventions.

## Level Selection

Ask: **Does this change affect SDK users?**

- `major`: Users must change their code to upgrade (API removal, breaking behavior change)
- `minor`: Users can do something new (new command, new field type, new config option, new API)
- `patch`: Invisible to users (bug fix, refactoring, perf, docs, tests, CI)

Common mistake: new CLI commands, new config options, and new field types are **minor**, not patch.

## Beta does not cover GA changes

"This feature is beta, so breaking changes are acceptable" applies **only to the beta surface itself** (the beta command/API). When a change also alters a stable (GA) code path — even if it ships alongside a beta feature in the same PR — judge and label that part as a **GA breaking change** on its own merits: give it its own breaking-change callout with migration steps, never a "(beta)" banner.

Check which module/command the diff actually touches, not the PR's headline feature. Example: a beta `setup github` overhaul that also makes `tailor-sdk apply` (GA) fail on a missing config `id` in CI is a GA breaking change — not a beta one.

## Description

Write from the SDK user's perspective. Describe what changed for them, not implementation details.

- Good: `Add decimal field type with optional scale parameter for fixed-point precision`
- Bad: `Refactor schema parser to add decimal Zod schema with regex validation`
