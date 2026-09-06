# Hello World

This is a sample project for [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/sdk).

This project was bootstrapped with [Create Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/create-sdk).

## Usage

1. Create a new workspace:

```bash
npx @tailor-platform/sdk login
npx @tailor-platform/sdk workspace create --name <workspace-name> --region <workspace-region>
npx @tailor-platform/sdk workspace list
# For yarn: yarn tailor <command>
# For pnpm: pnpm tailor <command>
# For bun: bun tailor <command>

# OR
# Create a new workspace using Tailor Platform Console
# https://console.tailor.tech/
```

2. Deploy the project:

```bash
npm run deploy -- --workspace-id <your-workspace-id>
# For yarn: yarn run deploy --workspace-id <your-workspace-id>
# For pnpm: pnpm run deploy --workspace-id <your-workspace-id>
# For bun: bun run deploy --workspace-id <your-workspace-id>
```

3. Open [Tailor Platform Console](https://console.tailor.tech/) and open GraphQL Playground.

4. Test GraphQL operations:

```graphql
query {
  hello(name: "sdk") {
    message
  }
}
# {
#   "data": {
#     "hello": {
#       "message": "Hello, sdk!"
#     }
#   }
# }
```

## Security

This template is a tutorial project: it defines no auth, and its permissions are fully open so you can deploy and query it right away. Replace both of the following before using it for anything real:

- `src/db/user.ts` grants `unsafeAllowAllTypePermission` / `unsafeAllowAllGqlPermission`, which allow every operation on the `User` table. Define conditions that match your requirements instead — see the [TailorDB Permission documentation](https://docs.tailor.tech/guides/tailordb/permission).
- `tailor.config.ts` sets `defaultPermission: "allowAnonymous"` for `main-resolver`, so its resolvers are callable without a token.

## Scripts

In the project directory, you can run:

- `deploy`: Deploy the project to Tailor Platform (`tailor deploy`)
- `generate`: Generate types for the project (`tailor generate`)
- `format`: Format the code using oxfmt
- `format:check`: Check code formatting using oxfmt
- `lint`: Lint the code using oxlint
- `lint:fix`: Fix linting issues using oxlint
- `typecheck`: Run TypeScript type checks
