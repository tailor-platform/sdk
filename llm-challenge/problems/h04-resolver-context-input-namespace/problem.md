# Destructure input and user from the resolver body's context argument

## Goal

Implement a query resolver named `"orderSummary"` whose `body` accepts a
**single context argument** (not two positional arguments) and projects both
the resolver `input` and the calling `user` into a structured response.

## Domain Context

The frontend asks the backend "what does this order look like, and who is
asking?" so it can render an order-detail page that also displays the
current viewer's identity. The `Order` TailorDB model (provided in
`tailordb/order.ts`) shapes the domain; the resolver re-projects a slice of
that domain alongside viewer attributes.

A common mistake is to write `body: (ctx, input) => ...` — that is, to
assume the resolver framework hands `input` as a positional second argument
the way many GraphQL adapters do. In this SDK, the body receives a **single
object** whose namespaces are `input`, `user`, `env`, and `invoker`. Writing
the body with two positional arguments still typechecks under loose typing
but receives `undefined` for the second arg at runtime.

## What to Build

The prewired `tailor.config.ts` already globs both `./tailordb/*.ts` and
`./resolvers/*.ts`. The `Order` model is provided in the scaffold under
`tailordb/order.ts` — you do not need to touch it. Complete
`resolvers/orderSummary.ts` so that it default-exports a resolver matching
the contract below.

| Field     | Required | Notes                                                |
| --------- | -------- | ---------------------------------------------------- |
| name      | yes      | `"orderSummary"`                                     |
| operation | yes      | `"query"`                                            |
| input     | yes      | object with `orderId: string`                        |
| output    | yes      | object with `orderId: string` and `viewerId: string` |
| body      | yes      | single-arg destructure, returns input+user mapping   |

The body must:

- accept exactly **one** parameter (the context object) and destructure
  `input` and `user` from it,
- return `{ orderId: input.orderId, viewerId: user.id }`.

## Requirements

- Use `createResolver` and the `t` namespace from `@tailor-platform/sdk`.
- Build the input schema with `{ orderId: t.string() }`.
- Build the output schema with `t.object({ orderId: t.string(), viewerId: t.string() })`.
- The resolver must be the file's default export.
- The body must take a single context argument (write the parameter list as
  `({ input, user })` or equivalent — not `(ctx, input)`).
- Do not introduce other resolvers in this file and do not touch
  `tailordb/order.ts`.

## Reference

Refer to the installed SDK package for the `createResolver` signature, the
shape of the body's single context argument (`{ input, user, env,
invoker }`), and the `t.string` / `t.object` builders. No external
documentation is required for this task.
