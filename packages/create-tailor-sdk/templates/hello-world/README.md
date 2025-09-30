# Hello World

This is a sample project for [Tailor SDK](https://www.npmjs.com/package/@tailor-platform/tailor-sdk).

This project was bootstrapped with [Create Tailor SDK](https://www.npmjs.com/package/@tailor-platform/create-tailor-sdk).

## Usage

1. Create a new workspace:

```bash
# Create a new workspace using tailorctl
tailorctl auth login
tailorctl workspace create --name <workspace-name> --region <workspace-region>
tailorctl config describe

# OR
# Create a new workspace using Tailor Platform Console
# https://console.tailor.tech/
```

2. Deploy the project:

```bash
WORKSPACE_ID=<your-workspace-id> npm run deploy
# OR
WORKSPACE_ID=<your-workspace-id> yarn run deploy
# OR
WORKSPACE_ID=<your-workspace-id> pnpm run deploy
```

3. Open [Tailor Platform Console](https://console.tailor.tech/) and open GraphQL Playground.

4. Test GraphQL operations:

```graphql
query {
  hello(input: { name: "sdk" }) {
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

## Scripts

In the project directory, you can run:

- `deploy`: Deploy the project to Tailor Platform
- `format`: Format the code using Prettier
- `format:check`: Check code formatting using Prettier
- `lint`: Lint the code using ESLint
- `lint:fix`: Fix linting issues using ESLint
- `typecheck`: Run TypeScript type checks
