---
"@tailor-platform/sdk": minor
---

Streamline workflow job function registration and trigger handling

**Breaking Changes:**

- Removed `deps` property from `createWorkflowJob()` - jobs no longer declare dependencies explicitly
- Removed `jobs` object from `WorkflowJobContext` - use `.trigger()` method instead
- Changed the way workflow jobs call other jobs: from `jobs.job_name()` to `otherJob.trigger()`

**Migration Guide:**

Before:

```typescript
export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async (input: { customerId: string }) => {
    // fetch logic
  },
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  deps: [fetchCustomer],
  body: async (input, { jobs }) => {
    const customer = await jobs.fetch_customer({
      customerId: input.customerId,
    });
    return { customer };
  },
});
```

After:

```typescript
export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async (input: { customerId: string }) => {
    // fetch logic
  },
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input, { env }) => {
    const customer = await fetchCustomer.trigger({
      customerId: input.customerId,
    });
    return { customer };
  },
});
```

**Key Changes:**

- Dependencies are now automatically detected via AST analysis of `.trigger()` calls at bundle time
- The `.trigger()` method is transformed to `tailor.workflow.triggerJobFunction()` during bundling
- Job function registration is optimized - all job functions are registered once and shared across workflows
- Unused jobs (not reachable from any mainJob via trigger calls) are automatically excluded from bundles
