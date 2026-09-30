---
"@tailor-platform/sdk-plugin-setup": minor
---

`tailor setup ci coordinate --action` now takes the action's name exactly as given to `tailor setup ci action` (its `--name`, or the config `name`), instead of also accepting it with a `tailor-` prefix. An action whose own name starts with `tailor-`, such as `tailor-crm`, is now passed as `--action tailor-crm` rather than `--action tailor-tailor-crm`. If you pass `--action tailor-api` for an action named `api`, the error now points you to `--action api`. `setup` remains a beta command, so this ships as an immediate change rather than going through a deprecation cycle.
