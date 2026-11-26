---
"@tailor-platform/sdk": patch
---

`tailor workflow run` and `tailor function run --async` no longer wait indefinitely after a run when the Platform does not answer the removal of its temporary resources. A removal that gets no answer within 30 seconds is given up on, together with the removals after it: the command prints the result and warns which resources were kept, and `tailor workflow prune` removes them. `tailor workflow prune`, `tailor deploy` when it removes the temporary resources of a TailorDB migration it ran, and `tailor seed apply` give up on such a removal the same way and go on.
