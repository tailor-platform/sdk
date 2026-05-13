# Fix an implicit any on a resolver context

## Goal

Make `resolvers/lookupRole.ts` typecheck under `strict` TypeScript. The
resolver factory accepts a `body` callback whose context argument is inferred
from the resolver schema — when the schema is complete, the context argument
is fully typed without any manual annotation.

## Domain Context

The SDK's resolver builder uses generics to thread the declared `input` schema
through to the `body` callback's argument. When `body` is declared as a
free-standing function whose parameter has no annotation, TypeScript cannot
back-propagate the generic and reports an implicit `any` under `strict`.
Inlining the body inside the `createResolver(...)` call (and supplying the
input schema) restores inference.

## What to Build

Repair `resolvers/lookupRole.ts` so that `npx tsc --noEmit` reports zero
errors and the resolver exports the same `name`/`operation` as in the
scaffold. The resolver should:

- Be named `"lookup-role"` with `operation: "query"`.
- Declare a single string `input` field called `userId` (use the SDK's `t.*`
  builders).
- Return a typed object `{ role: string }` from `body`.
- Use the context's `input.userId` to demonstrate that the schema flows
  through to `body`.

## Requirements

- After the fix, `tsc --noEmit` must pass.
- The fix must not introduce any explicit `: any` annotations or `@ts-ignore`
  pragmas; rely on inference.
- The exported default must still be the resolver instance.
- Do not edit `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the `createResolver` signature and the
input schema helpers. No external documentation is required for this task.
