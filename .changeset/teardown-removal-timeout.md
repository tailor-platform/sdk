---
"@tailor-platform/sdk": patch
---

`tailor workflow run` and `tailor function run --async` no longer wait indefinitely after a run when the Platform does not answer the removal of its temporary resources. A removal that gets no answer within 30 seconds is given up on, together with the removals after it: the command prints the result and warns which resources may remain, and `tailor workflow prune` removes them. `tailor workflow prune`, `tailor seed apply` once its script has run, and the removal of the resources of earlier finished runs that `tailor deploy`, `tailor workflow run`, and `tailor function run --async` also do give up on such a removal the same way and go on.
