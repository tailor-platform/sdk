# Define a many-to-one relation field

## Goal

Define a `Membership` TailorDB model whose `organizationId` field is a UUID that participates in a many-to-one relation toward the `Organization` model: many memberships can point at the same organization.

## Domain Context

A SaaS workspace links each `Membership` record to exactly one `Organization`. A single organization owns many memberships, so the relation runs from the membership side as many-to-one.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. The `Organization` model is already defined in `tailordb/organization.ts` and is imported for you in the scaffold; complete `tailordb/membership.ts` so that it exports a `membership` model named `"Membership"` with the field below.

| Field          | Kind | Options                              |
| -------------- | ---- | ------------------------------------ |
| organizationId | uuid | many-to-one relation to Organization |

## Requirements

- Use the relation builder available on UUID fields from `@tailor-platform/sdk` (the `db` namespace).
- The relation must be many-to-one (many memberships per organization).
- The relation target must be the `organization` model imported from `./organization`.
- Do not introduce other fields, hooks, validators, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the available relation builder API and the literal accepted by its `type` option. No external documentation is required for this task.
