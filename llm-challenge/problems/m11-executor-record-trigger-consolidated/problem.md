# Handle created+updated record events with a single trigger

## Goal

Define an executor that reacts to **both** `created` and `updated` events on
the `User` TailorDB model, using a **single** trigger definition (not two
sibling executors).

## Domain Context

A directory service emits an audit log entry whenever a user row appears or is
modified. Because the side effect is identical for the two cases, it should be
expressed once — the SDK provides a multi-event trigger for exactly this
shape.

## What to Build

Create `executors/userTouched.ts` whose default export is an executor with:

- `name`: `"user-touched"`
- A non-empty `description`
- A trigger bound to the `User` model that fires on both `created` and
  `updated` events (in that order)
- A `function` operation whose `body` accepts the trigger args without
  additional casts

The `User` model is already wired up at `tailordb/user.ts` and exported as
`user`.

## Requirements

- The executor must use a **single** trigger factory call from
  `@tailor-platform/sdk`. Do not emit two separate executors, one per event.
- The trigger metadata must list the platform event names for `created` and
  `updated` in that order.
- The trigger must target the `User` type.
- Do not edit `tailordb/user.ts` or `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the available trigger factories. No
external documentation is required for this task.
