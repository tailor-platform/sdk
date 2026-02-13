# 006: Database Access Resolver

## Goal

Create a query resolver that fetches a user from the database using `getDB()` and Kysely.

## Instructions

Create the file `resolvers/getUser.ts` with a **default export** that defines a resolver.

### Resolver Specification

- **Name**: `"getUser"`
- **Operation**: `"query"`
- **Input**:
  - `id` — string
- **Body**: Uses `getDB("tailordb")` to query the `"User"` table by `id`, returning the user's `name` and `email`.
  - Use Kysely's `.selectFrom("User")` to query the table
  - Select the `name` and `email` columns
  - Filter with `.where("id", "=", input.id)`
  - Use `.executeTakeFirstOrThrow()` to get a single result
  - Return an object with `name` and `email`
- **Output**: object with:
  - `name` — string
  - `email` — string

### Database Access

The `getDB` function is provided by the `@tailor-platform/kysely-type` generator and is imported from the generated file:

```typescript
import { getDB } from "../generated/tailordb";
```

This generator is already configured in the scaffold's `tailor.config.ts`.

## Scaffold

- A `tailor.config.ts` is provided with the `@tailor-platform/kysely-type` generator configured and `tailordb` / `resolver` file globs set up.
- A `tailordb/user.ts` is provided with a `User` model definition containing `name` and `email` fields.

## Example

Given a user record `{ id: "abc-123", name: "Alice", email: "alice@example.com" }` in the database, calling the resolver with input `{ id: "abc-123" }` should return `{ name: "Alice", email: "alice@example.com" }`.

## Reference

Refer to the installed SDK package for resolver definition patterns and the `getDB` / Kysely query builder usage.
