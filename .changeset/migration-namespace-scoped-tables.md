---
"@tailor-platform/sdk": patch
---

Keep `tailor deploy` migrations within their own TailorDB namespace when a table name exists in more than one, such as after moving a table between namespaces. A migration in one namespace could write its own schema over another namespace's table of the same name, delete that table before the other namespace's migration script read it, or skip writing that table's metadata.
