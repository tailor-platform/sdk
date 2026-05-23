# SDK API recall sheet (single-turn, no implementation)

This is a single-turn API recall task, not an implementation task.

For each surface listed below, write the one-line `firstImport` you would
add to the top of a fresh TypeScript file and the one-line `firstCall`
showing how you would invoke the SDK to satisfy the stated intent. Do not
implement the surrounding code, do not run any command, do not open files
under `node_modules/`, and do not write to any file in the project.

Respond with a single fenced JSON block (` ```json ... ``` `), nothing
before it and nothing after it. Use this schema exactly:

```json
{
  "surfaces": [
    {
      "key": "<one of the keys below, copied verbatim>",
      "firstImport": "<one import line, or empty string if you would not import anything new>",
      "firstCall": "<one line of TypeScript showing the first SDK call you would write>"
    }
  ]
}
```

Constraints on each entry:

- `firstCall` must reference the SDK API directly. Do not wrap it in a
  helper function defined elsewhere — show the call that touches
  `@tailor-platform/sdk` exports.
- `firstCall` is one line of TypeScript that would compile in context.
- If the intent could be satisfied by a method chain, show the head of
  the chain followed by the method you would call next (e.g.
  `db.uuid().relation({ type: "n-1", toward: { type: organization } })`).
- Output the surfaces in the order listed below. Include every surface;
  do not skip.

## Surfaces

1. `tailordb-type` — Define a TailorDB type/model named `Foo` with no fields.
2. `field-uuid` — Add a UUID field named `id`.
3. `field-array` — Add an array (multi-value) string field named `tags`.
4. `field-required-unique` — Add a required + unique string field named `email`.
5. `field-validate` — Attach a custom validation rule with an error message to a string field `slug`.
6. `relation-n-1` — UUID field `organizationId` as many-to-one relation toward an existing `organization` model.
7. `hooks-update-type` — Type-level `update` hook that mutates a field value before write.
8. `permission-role` — Role-gated permission rule on a TailorDB type.
9. `index-composite` — Composite index on `(organizationId, createdAt)`.
10. `resolver-create` — Create a custom resolver.
11. `executor-create` — Create an executor.
12. `trigger-record-created` — Executor trigger for record-created on a TailorDB type.
13. `trigger-multi-record` — Single executor trigger covering both record-created and record-updated.
14. `trigger-idp-user-multi` — Single executor trigger covering multiple IdP user events at once.
15. `trigger-schedule` — CRON-scheduled executor trigger.
16. `trigger-webhook` — Incoming webhook executor trigger.
17. `workflow-create` — Create a workflow.
18. `workflow-job` — Create a job that belongs to a workflow.
19. `workflow-wait-points` — Declare typed wait/resolve points used by a job.
20. `workflow-getdb` — Obtain a Kysely DB handle inside a job to query TailorDB.
21. `config-define` — Top-level project config.
22. `config-auth` — Auth config.
23. `config-idp` — Single IdP config.
24. `config-static-website` — Static website config.
25. `config-plugins` — Register plugins.
26. `plugin-kysely` — Kysely-type plugin required for `getDB()`.
