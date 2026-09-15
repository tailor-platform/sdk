# @tailor-platform/sdk-plugin-setup

Tailor CLI plugin that provides the `tailor setup` commands: generate GitHub Actions deploy workflows (branch, tag, preview, action, coordinate), a dependency-update config, and audit or delete what it generated.

> [!NOTE]
> This package is a **CLI plugin**: it ships an external `tailor-setup` executable that the Tailor CLI dispatches to when you run `tailor setup`.

## Installation

Install it next to `@tailor-platform/sdk` in your project:

```bash
npm install -D @tailor-platform/sdk-plugin-setup
```

The Tailor CLI discovers the plugin automatically from `node_modules/.bin` (or your `PATH`). Run `tailor plugin list` to confirm it resolves.

## Usage

```bash
# Branch target: deploy to stg on every push to main
tailor setup ci branch --name my-app-stg

# Tag target: deploy to production when a tag is pushed, with an approval gate
tailor setup ci tag --name my-app-prod --branch main --environment production

# Audit generated workflows for drift
tailor setup check
```

## Commands

| Command               | Description                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `setup ci branch`     | Generate a branch-target deploy workflow (push to branch triggers deploy).                           |
| `setup ci tag`        | Generate a tag-target deploy workflow (tag push triggers deploy).                                    |
| `setup ci preview`    | Generate a preview workflow (PR open/sync triggers deploy to a per-PR workspace).                    |
| `setup ci action`     | Generate a per-app composite action for use with `setup ci coordinate` (monorepo multi-app deploys). |
| `setup ci coordinate` | Generate a coordinator workflow that orchestrates multiple `--action`-generated composite actions.   |
| `setup deps`          | Generate a dependency update config for Tailor dependency and workflow updates.                      |
| `setup check`         | Audit generated workflows for drift against the current config/repo (read-only).                     |
| `setup delete`        | Delete managed workflow/action file(s) and their `.github/tailor.lock` entries.                      |

Run `tailor setup <command> --help` for the full option reference.

## Further reading

- [GitHub Actions Integration](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
