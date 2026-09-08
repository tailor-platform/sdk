# Multi-Application Guide

A sample project demonstrating multiple applications with shared databases using [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/sdk).

This project was bootstrapped with [Create Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/create-sdk).

## How It Works

This project contains two applications: `user` and `admin`.

- `user` application owns `shared-db` and deploys its resources
- `admin` application references `shared-db` as `external`, which exposes it in GraphQL without deploying duplicate resources

## Usage

1. Create a new workspace:

```bash
npx @tailor-platform/sdk login
npx @tailor-platform/sdk workspace create --name <workspace-name> --region <workspace-region>
```

2. Deploy the project:

```bash
TAILOR_PLATFORM_WORKSPACE_ID=<workspace-id> npm run deploy
```

This deploys both applications in order: `user` first, then `admin`.

3. Open [Tailor Platform Console](https://console.tailor.tech/) and verify:

- Two applications (`user` and `admin`) exist in your workspace
- In `admin` application's GraphQL Playground, `User` type from `shared-db` is available

## Security

This template is a tutorial project: its permissions are fully open so you can deploy and query it right away. Replace both of the following before using it for anything real:

- `apps/user/db/user.ts` grants `unsafeAllowAllTypePermission` / `unsafeAllowAllGqlPermission`, which allow every operation on the `User` table.
- `apps/admin/db/adminNote.ts` grants `unsafeAllowAllTypePermission` / `unsafeAllowAllGqlPermission`, which allow every operation on the `AdminNote` table.

Define conditions that match your requirements instead — see the [TailorDB Permission documentation](https://docs.tailor.tech/guides/tailordb/permission).

## Scripts

- `deploy`: Deploy all applications to Tailor Platform
- `deploy:user`: Deploy user application only
- `deploy:admin`: Deploy admin application only
- `format`: Format the code using oxfmt
- `format:check`: Check code formatting using oxfmt
- `lint`: Lint the code using oxlint
- `lint:fix`: Fix linting issues using oxlint
- `typecheck`: Run TypeScript type checks
