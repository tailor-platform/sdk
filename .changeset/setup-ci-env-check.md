---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

The workflows `tailor setup ci` generates now check the GitHub secrets and variables each job reads before using them. When a required one is empty, a `tailor-env-check` step fails the job with one error that names every empty entry and points to `tailor setup ci env --check` and `tailor setup ci env`, and prints the output of `tailor setup ci env --environment <environment>` in its log, instead of the job failing later with a message that differs per entry. The plan job and the autofix workflow's agent job only warn, and empty optional entries are listed in the log without failing. The step receives only whether each entry is set, never its value.

This release also raises the workflow template version, so `tailor setup check` reports a template-version finding for existing workflows until you run `tailor setup update`. With `TAILOR_PLATFORM_FAIL_ON_DRIFT` set to `true`, the drift check fails until then.
