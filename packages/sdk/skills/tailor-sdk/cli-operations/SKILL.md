---
name: tailor-sdk/cli-operations
description: >
  Use tailor-sdk CLI for deployment and operations. Covers apply,
  generate, login, workspace create/list/delete, tailordb truncate,
  tailordb migration generate/set/status, workflow start/executions/resume,
  executor trigger/jobs, machineuser token, secret vault/create,
  function test-run, staticwebsite deploy, --env-file, --workspace-id,
  --profile, --json flags.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/cli-reference.md"
  - "tailor-platform/sdk:packages/sdk/docs/cli/"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# CLI Operations

## Setup

Install and authenticate:

```bash
pnpm add @tailor-platform/sdk
tailor-sdk login
```

Set up a workspace profile for convenience:

```bash
tailor-sdk workspace create
tailor-sdk profile create
```

## Core Patterns

### Deploy to a workspace

```bash
tailor-sdk generate
tailor-sdk apply --workspace-id <workspace-id>
```

The first deploy requires `--workspace-id`. After creating a profile, you can omit it:

```bash
tailor-sdk apply
```

Options: `--dry-run`, `--no-schema-check`, `--no-cache`, `--clean-cache`

### Get a machine user token for API testing

```bash
tailor-sdk machineuser token admin-machine-user
```

Use with curl or any GraphQL client to test deployed resolvers.

### Start and monitor a workflow

```bash
tailor-sdk workflow start order-processing \
  -m admin-machine-user \
  -a '{"orderId": "abc-123"}' \
  --wait --logs

tailor-sdk workflow executions -n order-processing -s RUNNING --wait
```

### Test-run a function locally

```bash
tailor-sdk function test-run ./workflows/processOrder.ts \
  -n process-order \
  -a '{"orderId": "abc-123"}' \
  -m admin-machine-user
```

Note: `.trigger()` calls between jobs do NOT work in test-run mode.

## Common Mistakes

### HIGH Forgetting --workspace-id on first deploy

Wrong:

```bash
tailor-sdk apply
# Error: no workspace configured
```

Correct:

```bash
tailor-sdk apply --workspace-id <workspace-id>
# Or set up a profile first:
tailor-sdk profile create
tailor-sdk apply
```

The first deploy requires --workspace-id since no profile exists yet.

Source: docs/cli-reference.md

### HIGH .trigger() calls in test-run mode

Wrong:

```bash
# Expecting inter-job communication to work in test-run
tailor-sdk function test-run ./workflows/multi.ts -n main-job -m admin
# .trigger() calls silently fail
```

Correct:

```bash
# Test individual jobs in isolation
tailor-sdk function test-run ./workflows/multi.ts -n fetch-customer \
  -a '{"customerId": "abc"}' -m admin

# For full workflow testing, deploy and use:
tailor-sdk workflow start my-workflow -m admin -a '{}' --wait
```

Workflow job .trigger() calls do NOT work in function test-run mode. Test jobs individually or deploy for full workflow testing.

Source: docs/cli/function.md

### MEDIUM Skipping generate before apply

Wrong:

```bash
# Plugins configured but generate not run
tailor-sdk apply
# Bundle fails: cannot find generated/ imports
```

Correct:

```bash
tailor-sdk generate
tailor-sdk apply
```

If plugins are configured, run `tailor-sdk generate` before `tailor-sdk apply`. Without it, code importing generated files fails to bundle.

Source: docs/quickstart.md

## References

- [CLI command reference](references/cli-commands.md)

See also: tailor-sdk/code-generation/SKILL.md — tailor-sdk generate produces type files
See also: tailor-sdk/configuration/SKILL.md — config defines what CLI deploys
