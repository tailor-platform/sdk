# 004: Date/Time Model Definition

## Goal

Create a TailorDB model definition for an **Event** that uses various date, time, and numeric field types.

## Instructions

Create the file `tailordb/event.ts` that defines an `Event` model with the following fields:

| Field       | Type     | Required | Notes          |
| ----------- | -------- | -------- | -------------- |
| name        | string   | yes      |                |
| eventDate   | date     | yes      |                |
| startTime   | time     | yes      |                |
| endTime     | time     | no       | Optional field |
| capacity    | integer  | no       | Optional field |
| price       | float    | yes      |                |
| scheduledAt | datetime | yes      |                |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

## Requirements

- The file must have a **named export** `event` (the value)
- The file must also export the **type**: `export type event = typeof event;`

## Reference

Refer to the installed SDK package for model definition patterns.
