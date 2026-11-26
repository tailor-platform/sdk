---
"@tailor-platform/sdk": patch
---

`tailor workflow run` and `tailor function run --async` no longer wait indefinitely after a run when the Platform does not answer the removal of its temporary resources. A removal that gets no answer within 30 seconds is given up on, together with the removals after it: the command prints the result and warns which resources may remain, and `tailor workflow prune` removes them. The same limit applies, and the command goes on, when `tailor workflow prune` removes finished runs; when `tailor deploy`, `tailor tailordb migration test`, `tailor workflow run`, and `tailor function run --async` remove the resources of earlier finished runs; when `tailor seed apply` removes the resources of a seed script it ran; and when `tailor deploy` and `tailor remove` remove the temporary resources of a TailorDB migration that could not start or that failed before any of its steps committed.
