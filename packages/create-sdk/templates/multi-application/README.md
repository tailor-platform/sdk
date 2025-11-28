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
npx tailor-sdk login
npx tailor-sdk workspace create --name <workspace-name> --region <workspace-region>
```

2. Deploy the project:

```bash
TAILOR_PLATFORM_WORKSPACE_ID=<workspace-id> npm run deploy
```

This deploys both applications in order: `user` first, then `admin`.

3. Open [Tailor Platform Console](https://console.tailor.tech/) and verify:

- Two applications (`user` and `admin`) exist in your workspace
- In `admin` application's GraphQL Playground, `User` type from `shared-db` is available

## Scripts

- `deploy`: Deploy all applications to Tailor Platform
- `deploy:user`: Deploy user application only
- `deploy:admin`: Deploy admin application only
- `format`: Format the code using Prettier
- `format:check`: Check code formatting using Prettier
- `lint`: Lint the code using ESLint
- `lint:fix`: Fix linting issues using ESLint
- `typecheck`: Run TypeScript type checks
