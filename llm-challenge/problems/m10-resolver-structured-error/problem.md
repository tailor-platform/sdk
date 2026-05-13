# Return structured cancel results

## Goal

Implement a mutation resolver named `"cancel"` that returns a typed `{ success: boolean; error: string }` object describing the outcome of cancelling a subscription, without ever `throw`-ing.

## Domain Context

The frontend renders different UI for "happy path", "wrong state" and "not found". To keep the client logic simple, the resolver always returns a structured response — `success: true` with an empty `error` string on success, and `success: false` with a stable, human-readable `error` message on failure.

## What to Build

The override `tailor.config.ts` already wires resolvers from `./resolvers/*.ts`. Complete `resolvers/cancel.ts` so that it default-exports a resolver matching the contract below.

| Resolver | Operation | Input            | Output                                |
| -------- | --------- | ---------------- | ------------------------------------- |
| cancel   | mutation  | `{ id: string }` | `{ success: boolean; error: string }` |

Response semantics:

- `id === "sub-active"` returns `{ success: true, error: "" }`.
- `id === "sub-canceled"` returns `{ success: false, error: "Not active" }` (already cancelled).
- Any other `id` returns `{ success: false, error: "Not found" }`.

## Requirements

- Use `createResolver` and the `t` namespace from `@tailor-platform/sdk`.
- The output schema must be `t.object({ success: t.bool(), error: t.string() })`.
- The body must return a typed object in every branch. Do not `throw` on the error paths.
- The `error` field on the success path must be the empty string `""`.
- The error messages must be `"Not active"` and `"Not found"` verbatim.
- The resolver must be the file's default export.

## Reference

Refer to the installed SDK package for the `createResolver` signature and the `t.object` / `t.bool` / `t.string` builders. No external documentation is required for this task.
