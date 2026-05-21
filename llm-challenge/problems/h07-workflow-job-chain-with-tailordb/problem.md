# Chain three workflow jobs that share TailorDB state through `getDB`

## Goal

Build a billing workflow whose `mainJob` triggers two **named-export** child
jobs in sequence:

1. `loadAccount` — reads the current tier of an `Account` record from TailorDB
   via `getDB("tailordb")`.
2. `computeUpgradeCost` — receives the current tier and a desired target tier,
   and returns the upgrade `cost` (a simple lookup table, no DB access).

`mainJob` (`processUpgrade`) wires the two child jobs together and returns
`{ accountId, currentTier, targetTier, cost }`.

## Domain Context

A subscription platform processes plan-upgrade requests as a workflow so the
operations team can audit each step. Splitting "load the customer" and "price
the upgrade" into separate jobs lets us retry each step independently, but it
forces the SDK user to keep their head around four moving parts in one file:

- the TailorDB type that owns the row,
- a `kyselyTypePlugin` registration on the side of `defineConfig(...)` (so
  `generated/tailordb.ts` exists),
- three workflow-job factory invocations with the correct `name`, body shape,
  and `export` (named vs default),
- and a single workflow factory default export wiring the chosen `mainJob`.

Forgetting any one of these (e.g. exporting a child via the workflow rather
than as a named export, or missing `await` on a child trigger) makes the
runtime test fail silently.

## What to Build

The scaffold ships a completed `tailordb/account.ts` and a
`tailor.config.ts` that already wires `db.tailordb` and
`workflow.files`, but **does not register any plugin**. Two files require
work:

1. `tailor.config.ts` — append the `kyselyTypePlugin` registration via the
   SDK's plugin composition function (the one exported from
   `@tailor-platform/sdk` that takes plugin instances as rest arguments) and
   export the result as the named export `plugins` so
   `pnpm tailor-sdk generate` emits `./generated/tailordb.ts`.

2. `workflows/upgradeFlow.ts` — author all three jobs and the workflow using
   the SDK's workflow-job factory and the surrounding workflow factory:
   - `export const loadAccount = <workflow-job factory>({ name: "load-account", body })`
     whose body takes `{ accountId: string }`, calls
     `getDB("tailordb").selectFrom("Account").select(["tier"]).where("id", "=", accountId).executeTakeFirstOrThrow()`,
     and returns `{ currentTier: row.tier }`.
   - `export const computeUpgradeCost = <workflow-job factory>({ name: "compute-upgrade-cost", body })`
     whose body takes `{ currentTier: string; targetTier: string }` and returns
     `{ cost: number }`. Use the lookup table below; any unknown pair returns
     `{ cost: 0 }`.

     | currentTier | targetTier   | cost |
     | ----------- | ------------ | ---- |
     | "free"      | "pro"        | 20   |
     | "free"      | "enterprise" | 80   |
     | "pro"       | "enterprise" | 60   |

   - `export const processUpgrade = <workflow-job factory>({ name: "process-upgrade", body })`
     whose body takes `{ accountId: string; targetTier: string }` and:
     1. `await`s `loadAccount.trigger({ accountId })`.
     2. `await`s `computeUpgradeCost.trigger({ currentTier, targetTier })`.
     3. Returns `{ accountId, currentTier, targetTier, cost }`.
   - `export default <workflow factory>({ name: "upgrade-flow", mainJob: processUpgrade })`.

   The `<...>` placeholders mark the factory names you must discover from the
   SDK. They are exported from `@tailor-platform/sdk`. Do **not** invent your
   own helper wrappers; use the canonical SDK exports.

## Requirements

- `loadAccount`, `computeUpgradeCost`, and `processUpgrade` MUST be named
  exports; only the workflow factory's return value is the default export.
- Import `getDB` from `../generated/tailordb` (the path produced by
  `kyselyTypePlugin`). Do not edit `tailordb/account.ts` or the existing
  default export of `tailor.config.ts`.
- Use the `@tailor-platform/sdk/plugin/kysely-type` entrypoint for the plugin
  factory and the SDK's rest-argument plugin composition function from
  `@tailor-platform/sdk` for the registration shape.
- Each job body must `await` every preceding `.trigger()` call. The runtime
  harness invokes `processUpgrade.body(...)` directly, so missed awaits surface
  as `undefined` destructures.

## Reference

Refer to the installed SDK package for the workflow factory, the workflow-job
factory, the plugin composition function, and the `kyselyTypePlugin` factory.
No external documentation is required for this task.
