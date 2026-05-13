# Audit both record events and resolver runs without a composite trigger

## Goal

A billing service has to log audit entries every time:

1. An `Order` TailorDB record is **created** or **updated**, and
2. The `cancelOrder` resolver runs (regardless of `success`).

Two executors must subscribe to those streams and share a single audit helper
so that the audit format stays uniform across event sources.

## Domain Context

It is tempting to pass both event streams to a single `createExecutor(...)`
call by combining triggers (e.g. `recordTrigger({ ... })` together with
`resolverExecutedTrigger({ ... })`). The SDK does not support a composite
trigger — `createExecutor` takes exactly one `trigger`. The intended pattern
is to ship two executors and reuse a small helper module.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`, `./resolvers/*.ts`,
and `./executors/*.ts`. The `cancelOrder` resolver and `Order` TailorDB type
are already provided in `scaffold/`. Complete three files:

1. `executors/_audit.ts` — exports a named function `recordAudit` matching
   the signature `(args: { source: string; reference: string }) => { entry: string }`
   that returns `{ entry: "<source>:<reference>" }` so both executors produce
   uniform audit strings. The helper must be a plain TypeScript function (no
   `createExecutor` wrapping).

2. `executors/orderTouched.ts` — default-exports an executor named
   `"order-touched"` with a non-empty description that:
   - Uses `recordTrigger({ type: order, events: ["created", "updated"] })`
     so a single executor handles both record events.
   - Has a `function` operation whose body calls `recordAudit` with
     `source: "order"` and `reference: args.newRecord.id`.

3. `executors/cancelAudit.ts` — default-exports an executor named
   `"cancel-audit"` with a non-empty description that:
   - Uses `resolverExecutedTrigger({ resolver: cancelOrder })` (no condition;
     audit both success and failure).
   - Has a `function` operation whose body calls `recordAudit` with
     `source: "resolver"` and `reference: args.resolverName`.

## Requirements

- The helper must live at `executors/_audit.ts` and be imported into both
  executor files by relative path. Inlining the audit format in either
  executor is forbidden.
- Neither executor may pass more than one trigger; do not invent a composite
  trigger factory.
- Both executor files must `export default createExecutor(...)`.
- Do not edit `tailor.config.ts`, `tailordb/order.ts`, or
  `resolvers/cancelOrder.ts`.

## Reference

Refer to the installed SDK package for `createExecutor`, `recordTrigger`, and
`resolverExecutedTrigger`. No external documentation is required for this
task.
