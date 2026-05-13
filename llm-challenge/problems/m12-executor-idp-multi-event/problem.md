# Handle IdP user created+deleted events with a single trigger

## Goal

Define an executor that reacts to **both** `created` and `deleted` IdP user
events in a single trigger declaration (not two sibling executors).

## Domain Context

A directory service emits an audit log entry whenever a user appears in the
IdP namespace or is removed from it. The side effect is identical, so the
trigger should be expressed once — the SDK provides a multi-event trigger
for exactly this shape.

## What to Build

Create `executors/idpAudit.ts` whose default export is an executor with:

- `name`: `"idp-user-audit"`
- A non-empty `description`
- A trigger that fires on both `created` and `deleted` IdP user events (in
  that order)
- A `function` operation whose `body` accepts the trigger args without
  additional casts

`tailor.config.ts` already wires up an IdP and the executors directory.

## Requirements

- The executor must use a **single** trigger factory call from
  `@tailor-platform/sdk`. Do not emit two separate executors, one per event.
- The trigger metadata must list the platform event names for `created` and
  `deleted` in that order.
- The trigger must subscribe to IdP user events.
- Do not edit `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the available trigger factories. No
external documentation is required for this task.
