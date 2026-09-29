---
"@tailor-platform/sdk-plugin-setup": major
---

Reserve the `tailor-` id prefix in generated workflows and composite actions for the SDK. A job or step you add whose `id` starts with `tailor-` is now reported by `setup check` (rule key `reserved-id`), and re-running `setup` stops on it and names the id, instead of silently treating it as yours. Rename such ids (for example `tailor-build-frontend` to `build-frontend`) before upgrading.

`--force` no longer replaces a job or step of yours whose id a new template starts to manage; `setup` stops and asks you to rename it instead. A step without the `tailor-` prefix is now always kept on regeneration, even when `.github/tailor.lock` lists its id.
