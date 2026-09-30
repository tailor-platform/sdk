---
"@tailor-platform/sdk-plugin-setup": minor
---

Reserve the `tailor-` id prefix in generated workflows and composite actions for the SDK. A job or step you add whose `id` starts with `tailor-` is now reported by `setup check` (rule key `reserved-id`), and re-running `setup` stops on it and names the id, instead of silently treating it as yours. Rename such ids (for example `tailor-build-frontend` to `build-frontend`) before upgrading. `setup` remains a beta command, so this ships as an immediate breaking change rather than going through a deprecation cycle.

`--force` no longer replaces a job or step of yours whose id a new template starts to manage; `setup` stops and asks you to rename it instead. A step without the `tailor-` prefix is now always kept on regeneration, even when `.github/tailor.lock` lists its id, except the id an older template used for a step it has since renamed (such as `build-site` below) until the file is regenerated once.

The composite action's static website build step is renamed from `build-site` to `tailor-build-site`, so every SDK-managed step carries the prefix. Re-running `setup ci action` renames it and keeps the `run:` command you wrote; the `build-site` input of the action is unchanged.

A hand edit to an SDK-managed part now names the edited job, step, or top-level key (for example `"tailor-preview-deploy/tailor-preview-comment"`) in `setup check` and when re-running `setup`. Files whose lock entry was written by an older plugin keep the generic message until they are regenerated once.
