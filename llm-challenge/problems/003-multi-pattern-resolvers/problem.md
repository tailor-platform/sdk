# 003: Multi-Pattern Resolvers

## Goal

Create a utility resolver library for a web application. The app needs arithmetic operations, name formatting, number analysis, and user identity resolution. Each resolver demonstrates a different pattern: query vs mutation, typed inputs, array processing, and user context access.

## Requirements

Create the following 4 resolver files, each with a **default export** using `createResolver`:

### 1. `resolvers/calculator.ts` — Arithmetic Operations

A **query** resolver named `"calculator"` that takes two integers and returns their sum and product.

- **Input**: `a` (integer), `b` (integer)
- **Output**: object with `sum` (integer) and `product` (integer)

### 2. `resolvers/formatName.ts` — Name Formatting

A **mutation** resolver named `"formatName"` that formats a person's name.

- **Input**: `firstName` (string), `lastName` (string), `uppercase` (boolean, optional)
- **Body logic**:
  - `fullName`: `"<firstName> <lastName>"` — if `uppercase` is true, convert to uppercase
  - `initials`: first letter of each name, always uppercase (e.g., `"JD"`)
- **Output**: object with `fullName` (string) and `initials` (string)

### 3. `resolvers/categorizeNumbers.ts` — Number Analysis

A **query** resolver named `"categorizeNumbers"` that categorizes an array of numbers.

- **Input**: `numbers` (array of integers)
- **Body logic**:
  - `positives`: numbers > 0
  - `negatives`: numbers < 0
  - `zeros`: count of zeros
  - `summary`: enum — `"empty"` if input is empty, `"all_positive"` if all > 0, `"all_negative"` if all < 0, `"mixed"` otherwise (including when zeros are present)
- **Output**: object with `positives` (integer array), `negatives` (integer array), `zeros` (integer), `summary` (enum: `["all_positive", "all_negative", "mixed", "empty"]`)

### 4. `resolvers/whoami/resolver.ts` — User Identity

A **query** resolver named `"whoami"` with no input that reads the current user's context.

- **Body**: Access `user.id`, `user.type`, and `user.attributes` from the context
- **Output**: object with `userId` (string), `userType` (string), `attributes` (optional object)

## Scaffold

A `tailor.config.ts` is provided that references `./resolvers/**/resolver.ts` and `./resolvers/*.ts`.

## Reference

Refer to the installed SDK package for resolver definition patterns.
