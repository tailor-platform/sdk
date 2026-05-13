# Trigger an executor when a specific resolver runs

## Goal

Define an executor that fires whenever the `upgrade` resolver completes
successfully, recording an audit log entry.

## Domain Context

A subscription service exposes an `upgrade` mutation that bumps a customer's
plan. After every successful upgrade the platform must call an external
auditing endpoint with the new plan; failures should be ignored.

## What to Build

Create `executors/upgradeAudit.ts` whose default export is an executor with:

- `name`: `"upgrade-audit"`
- A non-empty `description`
- A trigger that fires when the `upgrade` resolver is executed, only when
  the execution succeeded
- A `function` operation whose `body` accepts the trigger args without
  additional casts

The `upgrade` resolver is already implemented at `resolvers/upgrade.ts` and
exported as the default export.

## Requirements

- The trigger factory must reference the **resolver instance** (not a string
  name).
- The trigger must include a `condition` that returns truthy only when the
  resolver's execution succeeded.
- The recorded trigger metadata must list `"upgrade"` as the resolver name.
- Do not edit `resolvers/upgrade.ts` or `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the available trigger factories and
the shape of the resolver-execution args. No external documentation is
required for this task.
