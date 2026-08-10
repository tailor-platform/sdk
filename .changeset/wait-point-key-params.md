---
"@tailor-platform/sdk": minor
---

Support wait point keys with runtime values. Write `$paramName` in a key passed to `createWaitPoints`' `define` and the param names become the argument of `.with()`, which builds the concrete key:

```typescript
export const { lineApproval } = createWaitPoints((define) => ({
  lineApproval: define.for("line-approval-$lineId")<{ message: string }, { approved: boolean }>(),
}));

await lineApproval.with({ lineId: line.id }).wait({ message: "Please approve" });
```

This makes it possible for one execution to suspend on the same logical wait point more than once at a time — one approval per order line, one per approver — which previously failed because a suspension with that key was already pending. A parameterized wait point exposes only `.with()`, so the unsubstituted key can never be waited on. `mockWorkflow().waitPointWith(definition, params)` gives typed mocks for one binding.

The key has to come before the `Payload` / `Result` type arguments, because TypeScript stops inferring it as a literal type once those are given explicitly, and the param names can only be read off a literal. `createWaitPoint` takes its type arguments first, so it cannot type `$params`; `deploy` rejects such a key and points at `createWaitPoints`. Its own signature is unchanged.

Wait point keys are now checked by `deploy` instead of failing when the job creates the suspension. Keys must match `[a-z0-9-]`, be 3 to 63 characters long, and start and end with `[a-z0-9]`. A key that never worked — a camelCase `createWaitPoints` property name, say — was rejected by the platform once the job ran; `deploy` now reports it before anything is deployed. Inside `createWaitPoints`, pass a valid key to `define` to keep the property name you read at the call site:

```typescript
managerApproval: define.for("manager-approval")<{ amount: number }, { approved: boolean }>(),
```

This works for a key without `$params` too, which is the way to keep a property name that reads well at the call site while the key stays within the platform grammar.
