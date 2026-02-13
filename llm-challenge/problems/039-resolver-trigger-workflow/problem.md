# 039: Resolver that Triggers a Workflow

## Goal

Create a resolver whose body triggers a workflow job using the `.trigger()` method.

## Instructions

A workflow with a `processDataJob` job is already provided in `workflows/dataProcessing.ts`. Create the file `resolvers/startProcessing/resolver.ts` that defines a resolver which triggers that workflow job.

The resolver should:

- Be a **mutation** named `"startProcessing"`
- Accept input fields:
  - `dataId` (string, required)
  - `priority` (enum with values `"low"`, `"medium"`, `"high"`)
- In the body, call `processDataJob.trigger()` with the input values and return the result
- Return an object with `triggered` (bool) and `result` (optional object)

## Requirements

- Import `processDataJob` from the workflow file
- Use `.trigger()` to invoke the workflow job (do NOT use `await` - it is synchronous on server)
- The file must have a **default export**

## Reference

Refer to the installed SDK package for resolver definition and workflow trigger patterns.
