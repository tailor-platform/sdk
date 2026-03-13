---
name: tailor-sdk
description: >
  Core overview for @tailor-platform/sdk. Covers defineConfig, db.type,
  createResolver, createExecutor, createWorkflow, tailor-sdk CLI. Use when
  working with any Tailor Platform SDK project — this skill routes to
  focused sub-skills for each domain.
type: core
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/README.md"
  - "tailor-platform/sdk:packages/sdk/docs/configuration.md"
---

# Tailor Platform SDK — Core Concepts

TypeScript SDK for declaratively defining and deploying enterprise applications
on the Tailor Platform. Define database schemas, custom GraphQL resolvers,
event-driven executors, and workflow orchestration in TypeScript, then deploy
via CLI.

## Sub-Skills

| Need to...                                 | Read                                 |
| ------------------------------------------ | ------------------------------------ |
| Scaffold a new project                     | tailor-sdk/project-setup/SKILL.md    |
| Configure tailor.config.ts, auth, IdP      | tailor-sdk/configuration/SKILL.md    |
| Define TailorDB types, fields, permissions | tailor-sdk/model-definition/SKILL.md |
| Generate TypeScript types from models      | tailor-sdk/code-generation/SKILL.md  |
| Create custom GraphQL resolvers            | tailor-sdk/resolver/SKILL.md         |
| Set up event-driven executors              | tailor-sdk/executor/SKILL.md         |
| Orchestrate multi-step workflows           | tailor-sdk/workflow/SKILL.md         |
| Use the CLI for deploy and operations      | tailor-sdk/cli-operations/SKILL.md   |
| First project from scratch to deploy       | tailor-sdk/quickstart/SKILL.md       |

## Quick Decision Tree

- First time using Tailor SDK? → tailor-sdk/quickstart/SKILL.md
- Defining database models? → tailor-sdk/model-definition/SKILL.md
- Writing business logic? → tailor-sdk/resolver or tailor-sdk/workflow
- Deploying or managing workspaces? → tailor-sdk/cli-operations/SKILL.md
- Debugging permission errors? → tailor-sdk/model-definition/SKILL.md § Common Mistakes

## Architecture Overview

A Tailor Platform project follows this structure:

```
my-app/
├── tailor.config.ts          # defineConfig — wires all services
├── tailordb/                 # db.type() model definitions
│   ├── user.ts
│   └── order.ts
├── resolvers/                # createResolver — custom GraphQL endpoints
│   └── myResolver.ts
├── executors/                # createExecutor — event-driven automation
│   └── onOrderCreated.ts
├── workflows/                # createWorkflow — multi-step orchestration
│   └── processOrder.ts
├── generated/                # Output of tailor-sdk generate
│   └── tailordb.ts
└── package.json
```

Key imports:

```typescript
import {
  defineConfig,
  defineAuth,
  defineIdp,
  defineStaticWebSite,
  definePlugins,
  db,
  t,
  createResolver,
  createExecutor,
  createWorkflow,
  createWorkflowJob,
  recordCreatedTrigger,
  scheduleTrigger,
  incomingWebhookTrigger,
} from "@tailor-platform/sdk";
```

## Version

Targets @tailor-platform/sdk v1.25.1.
