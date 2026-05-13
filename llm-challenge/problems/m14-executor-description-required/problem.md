# Author an executor with a non-empty description

## Goal

Define an executor that reacts when a `User` record is created. The executor
must carry a non-empty human-readable `description` that explains what it
does — the platform surfaces this string to operators in dashboards.

## Domain Context

A directory service ships an audit log entry every time a new user is
provisioned. The team standardises on writing a one-sentence English summary
for every executor so on-call engineers can identify what each side effect
is doing without reading source code.

## What to Build

Create `executors/userCreated.ts` whose default export is an executor with:

- `name`: `"user-created"`
- A `description` string that is **non-empty** and describes the executor's
  purpose
- A trigger that fires when a `User` record is created
- A `function` operation that runs when the trigger fires

The `User` model is already wired up at `tailordb/user.ts` and exported as
`user`.

## Requirements

- The executor's `description` must be a non-empty string.
- The trigger must fire on the `created` event for the `User` model.
- Do not edit `tailordb/user.ts` or `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the executor configuration shape. No
external documentation is required for this task.
