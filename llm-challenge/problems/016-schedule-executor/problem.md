# 016: Schedule Executor

## Goal

Create an executor that triggers on a schedule using a cron expression.

## Instructions

Create the file `executors/dailyReport.ts` with a **default export** that defines an executor.

## Requirements

- **Name**: `"daily-report"`
- **Description**: `"Generates a daily report at 9 AM JST"`
- **Trigger**: A schedule trigger with:
  - cron: `"0 9 * * *"` (every day at 9:00 AM)
  - timezone: `"Asia/Tokyo"`
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that logs `"Generating daily report"` using `console.log`

## Reference

Refer to the installed SDK package for executor and schedule trigger definition patterns.
