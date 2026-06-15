# Workflow Template

Demonstrates workflow patterns with job chaining, trigger testing, and dependency injection.

## Features

- Workflow with multiple jobs (`createWorkflow`, `createWorkflowJob`)
- Job chaining via `.trigger()`
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
