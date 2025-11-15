# Hello World

This is a sample project for [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/sdk).

This project was bootstrapped with [Create Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/create-sdk).

## Usage

1. Create a new workspace:

```bash
npx tailor-sdk login
npx tailor-sdk workspace create --name <workspace-name> --region <workspace-region>
npx tailor-sdk workspace list
# For yarn: yarn tailor-sdk <command>
# For pnpm: pnpm tailor-sdk <command>

# OR
# Create a new workspace using Tailor Platform Console
# https://console.tailor.tech/
```

2. Deploy the project:

```bash
npm run deploy -- --workspace-id <your-workspace-id>
# For yarn: yarn run deploy --workspace-id <your-workspace-id>
# For pnpm: pnpm run deploy --workspace-id <your-workspace-id>
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
