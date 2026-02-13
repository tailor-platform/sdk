# 003: Mutation Resolver

## Goal

Create a mutation resolver that formats a person's name.

## Instructions

Create the file `resolvers/formatName.ts` with a **default export** that defines a resolver.

### Resolver Specification

- **Name**: `"formatName"`
- **Operation**: `"mutation"`
- **Input**:
  - `firstName` — string
  - `lastName` — string
  - `uppercase` — boolean (optional)
- **Body**: Takes the input and returns an object with:
  - `fullName` — `"<firstName> <lastName>"` (if `uppercase` is true, convert the entire result to uppercase)
  - `initials` — first letter of firstName + first letter of lastName (always uppercase, e.g., `"JD"`)
- **Output**: object with:
  - `fullName` — string
  - `initials` — string

## Scaffold

A `tailor.config.ts` is provided that references `./resolvers/*.ts`.

## Example

Given input `{ firstName: "John", lastName: "Doe", uppercase: false }`, the resolver should return `{ fullName: "John Doe", initials: "JD" }`.

Given input `{ firstName: "Jane", lastName: "Smith", uppercase: true }`, the resolver should return `{ fullName: "JANE SMITH", initials: "JS" }`.

## Reference

Refer to the installed SDK package for resolver definition patterns.
