# Workflow Template

Demonstrates workflow patterns with job chaining, start testing, and dependency injection.

## Features

- Workflow with multiple jobs (`createWorkflow`, `createWorkflowJob`)
- Job chaining via `.start()`
- Database operations in workflow jobs (DI pattern)
- Integration testing with `runWorkflowLocally()`

## Getting Started

```bash
pnpm install
pnpm generate
pnpm deploy
```

## Testing

```bash
pnpm test
```
