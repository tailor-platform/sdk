# 001: Comprehensive Model Definition

## Goal

Build out the data models for a **company management system**. The system tracks employees, company events, and user profiles.

A `User` model is already provided in `tailordb/user.ts`. You need to create three new models that together form the core of this domain.

## Domain Context

- **Employees** have personal details, belong to a department, and must pass basic validation (reasonable name length, valid age range). Each employee has a structured home address.
- **Events** represent company happenings (meetings, conferences, parties) with scheduling information across different temporal granularities (dates, times, datetimes) and numeric capacity/pricing data.
- **Profiles** extend the existing User model with optional biographical information, forming a strict one-to-one relationship.

## What to Build

### 1. `tailordb/employee.ts` - Employee Model

An employee record with:

- `name` (string, required) - must be validated to be at least 2 characters long, with error message "Name must be at least 2 characters"
- `age` (integer, required) - must be validated: >= 18 ("Must be at least 18") and <= 120 ("Must be at most 120")
- `email` (string, required) - no validation needed
- `department` (enum, required) - allowed values: `engineering`, `sales`, `marketing`, `hr`
- `address` (nested object, required, not an array) - contains:
  - `street` (string, required)
  - `city` (string, required)
  - `state` (string, optional)
  - `zipCode` (string, required)
  - `country` (string, required)
- Automatic timestamps

### 2. `tailordb/event.ts` - Event Model

A company event record with various temporal and numeric field types:

- `name` (string, required)
- `eventDate` (date, required)
- `startTime` (time, required)
- `endTime` (time, optional)
- `capacity` (integer, optional)
- `price` (float, required)
- `scheduledAt` (datetime, required)
- Automatic timestamps

### 3. `tailordb/profile.ts` - Profile Model

A user profile that has a one-to-one relationship with the provided User model:

- `userId` (uuid, required) - 1-1 relation to User, with `toward.as` set to `"owner"` and `backward` set to `"profile"`
- `bio` (string, optional)
- `avatarUrl` (string, optional)
- Automatic timestamps

## Requirements

- Each file must have a **named export** matching the model name in camelCase (e.g., `employee`, `event`, `profile`)
- Each file must also export the **type**: `export type modelName = typeof modelName;`
- Import the `user` from `./user` for the Profile relation
- Use `.validate()` for Employee field validations - each rule is `[validatorFunction, errorMessage]`

## Reference

Refer to the installed SDK package for model definition patterns, nested objects, relations, and validation.
