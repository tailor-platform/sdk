# 033: Resolver with User Context

## Goal

Create a query resolver that accesses the current user's context information.

## Instructions

Create the file `resolvers/whoami/resolver.ts` with a **default export** that defines a resolver.

### Resolver Specification

- **Name**: `"whoami"`
- **Operation**: `"query"`
- **Input**: none
- **Body**: Receives the context object and returns:
  - `userId` — `user.id`
  - `userType` — `user.type`
  - `attributes` — `user.attributes`
- **Output**: object with:
  - `userId` — string
  - `userType` — string
  - `attributes` — optional object

## Scaffold

A `tailor.config.ts` is provided that references `./resolvers/**/resolver.ts`.

## Example

Given a user context `{ id: "user-123", type: "user", attributes: { role: "admin" } }`, the resolver should return:

```json
{
  "userId": "user-123",
  "userType": "user",
  "attributes": { "role": "admin" }
}
```

## Reference

Refer to the installed SDK package for resolver definition patterns.
