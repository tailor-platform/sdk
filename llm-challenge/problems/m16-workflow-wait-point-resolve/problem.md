# Gate a workflow on a typed wait point

## Goal

Build an approval workflow whose main job pauses on a typed wait point,
returning a status that depends on the resolved payload.

## Domain Context

A purchase request must be approved by a human before it can proceed. The
workflow's main job collects the request, suspends on a wait point that
expects an `{ approved: boolean }` response, and resumes with either
`"approved"` or `"rejected"` based on the human's decision.

## What to Build

Create `workflows/approval.ts` that exports:

- A named export `approval`: a typed wait point whose `wait` accepts
  `{ message: string }` and whose `resolve` callback returns
  `{ approved: boolean }`.
- A named export `processApproval`: a workflow job named
  `"process-approval"` that takes `{ requestId: string }`, calls
  `approval.wait({ message })` with the request id embedded in the message,
  and returns `{ requestId, status: "approved" | "rejected" }` based on the
  resolved value.
- A default export `createWorkflow({ name: "approval-workflow", mainJob: processApproval })`.

## Requirements

- `approval` must be exported as a **named** export (do not bundle it into
  the workflow's default export).
- The job body must `await` the wait point and branch on `approved`.
- The status must be exactly `"approved"` when the resolved payload's
  `approved` is true, and `"rejected"` otherwise.

## Reference

Refer to the installed SDK package for typed wait-point authoring. No
external documentation is required for this task.
