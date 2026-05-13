# Write a query resolver with an object output

## Goal

Implement a query resolver named `"userPing"` whose output is a single-field object `{ ok: boolean }` returning `true` every time it is called.

## Domain Context

The frontend periodically pings the service to confirm the user session is still valid. The resolver responds with a small, structured object so the client can branch on a boolean rather than a bare scalar.

## What to Build

Override `tailor.config.ts` already wires `resolver` for this problem, pointing at `./resolvers/*.ts`. Complete `resolvers/userPing.ts` so that it default-exports a resolver matching the contract below.

| Resolver | Operation | Input | Output                         | Body returns   |
| -------- | --------- | ----- | ------------------------------ | -------------- |
| userPing | query     | none  | object with `ok` boolean field | `{ ok: true }` |

## Requirements

- Use `createResolver` and the `t` namespace from `@tailor-platform/sdk` to build the output schema.
- The output must be created with `t.object({ ok: t.bool() })`. Do **not** reach for `db.*` builders for resolver output.
- The resolver must have `operation: "query"` and `name: "userPing"`.
- The body must return `{ ok: true }`.
- The resolver must be the file's default export.
- Do not introduce other resolvers in this file.

## Reference

Refer to the installed SDK package for the `createResolver` signature and the `t.object` / `t.bool` builders. No external documentation is required for this task.
