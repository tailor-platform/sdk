---
name: tailor-sdk/project-setup
description: >
  Scaffold a new Tailor Platform project using create-sdk. Covers
  npm create @tailor-platform/sdk, --template flag, project directory
  structure, tailor.config.ts skeleton, pnpm workspace setup. Use when
  creating a new project or understanding the generated file structure.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/quickstart.md"
  - "tailor-platform/sdk:packages/create-sdk/src/index.ts"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# Project Setup

## Setup

Create a new project with the hello-world template:

```bash
npm create @tailor-platform/sdk -- --template hello-world my-app
cd my-app
pnpm install
```

Requirements:

- Node.js 22+ (check with `node --version`)
- pnpm (the SDK uses pnpm workspaces)

## Core Patterns

### Generated project structure

```
my-app/
├── tailor.config.ts      # Application configuration
├── tailordb/             # TailorDB type definitions
├── resolvers/            # Custom GraphQL resolvers
├── executors/            # Event-driven executors
├── workflows/            # Workflow definitions
├── package.json          # pnpm workspace with SDK dependency
└── tsconfig.json
```

### First deploy

After scaffolding, log in, create a workspace, and deploy:

```bash
tailor-sdk login
tailor-sdk workspace create
tailor-sdk apply --workspace-id <workspace-id>
```

## Common Mistakes

### HIGH Wrong Node.js version

Wrong:

```bash
# Node 18 or 20
node --version  # v20.x.x
npm create @tailor-platform/sdk -- --template hello-world my-app
```

Correct:

```bash
node --version  # v22.14.0 or later
npm create @tailor-platform/sdk -- --template hello-world my-app
```

SDK requires Node.js 22+. Older versions fail silently or produce runtime errors.

Source: docs/quickstart.md

### HIGH Using npm instead of pnpm for project operations

Wrong:

```bash
npm install
npm run deploy
```

Correct:

```bash
pnpm install
pnpm run deploy
```

The SDK uses pnpm workspaces. npm produces incorrect node_modules layout.

Source: package.json packageManager field

### MEDIUM Missing --template flag in create command

Wrong:

```bash
npm create @tailor-platform/sdk my-app
```

Correct:

```bash
npm create @tailor-platform/sdk -- --template hello-world my-app
```

The `--` separator is required before template flags. Without --template, you get an interactive prompt or error.

Source: docs/quickstart.md

See also: tailor-sdk/quickstart/SKILL.md — end-to-end first deployment guide
See also: tailor-sdk/configuration/SKILL.md — configuring tailor.config.ts after scaffolding
