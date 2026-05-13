# Write a mutation resolver with input

## Goal

Implement a mutation resolver named `"createTask"` that takes a single string input field `title` and returns the supplied title back inside an object that also carries a deterministic id `"task-1"`.

## Domain Context

The frontend submits a new task title; the backend echoes the title and assigns an id so the client can immediately update its local cache. The resolver therefore needs both an input schema for the incoming payload and a structured output describing the response.

## What to Build

The override `tailor.config.ts` already wires resolvers from `./resolvers/*.ts`. Complete `resolvers/createTask.ts` so that it default-exports a resolver matching the contract below.

| Resolver   | Operation | Input               | Output                          | Body returns                           |
| ---------- | --------- | ------------------- | ------------------------------- | -------------------------------------- |
| createTask | mutation  | `{ title: string }` | `{ id: string; title: string }` | `{ id: "task-1", title: input.title }` |

## Requirements

- Use `createResolver` and the `t` namespace from `@tailor-platform/sdk`.
- Declare the `input` schema as an object of field builders, e.g. `{ title: t.string() }`. Do **not** add a positional `args` parameter to `body`.
- Read the title inside `body` from the context's `input` property — `body` is invoked with a single context argument.
- The resolver must have `operation: "mutation"` and `name: "createTask"`.
- The body must return `{ id: "task-1", title: input.title }`.
- The resolver must be the file's default export.

## Reference

Refer to the installed SDK package for the `createResolver` signature, the way `input` flows into the body context, and the `t` builders. No external documentation is required for this task.
