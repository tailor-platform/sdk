# Content Mapper

This is a sample project for [Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/sdk). TypeScript derives its types from `tailor.config.ts` through the SDK's content mapper, so the project has no `tailor.d.ts` and no generated Kysely types file.

This project was bootstrapped with [Create Tailor Platform SDK](https://www.npmjs.com/package/@tailor-platform/create-sdk).

## Requirements

The content mapper needs TypeScript 7.1 or later. TypeScript 7.1 is in beta, so this project pins `typescript@7.1.0-beta`.

## How the Types Come From the Config

- `tsconfig.json` adds the SDK as a content mapper for `.tailor` files:

  ```json
  "contentMappers": [{ "package": "@tailor-platform/sdk", "extensions": [".tailor"] }]
  ```

- The `typecheck` script runs `tsc --noEmit --runExternalCode`. With `--runExternalCode`, TypeScript runs `tailor.config.ts` and the files it imports each time it checks the project, so use it only for code you trust.
- `tailor.config.ts` configures `kyselyTypePlugin({ contentMapper: true })`, so `getDB()` imported from `@tailor-platform/sdk/plugin/kysely-type/db` is typed from the tables in `src/db/`.
- `src/content-mapper.types.ts` type-checks only while the mapper runs: it rejects a misspelled machine user name, an `env` key and a `role` attribute value that `tailor.config.ts` does not define, and an unknown table.

An editor whose TypeScript is older than 7.1 does not run the content mapper, so its diagnostics and completions do not reflect `tailor.config.ts`.

To enable the mapper in an existing project, also delete its old `tailor.d.ts`. See [Type Definitions Without `tailor generate`](https://github.com/tailor-platform/sdk/blob/main/packages/sdk/docs/configuration.md#type-definitions-without-tailor-generate) for details.

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

3. Get the machine user's token:

```bash
npx @tailor-platform/sdk machineuser token admin-machine-user --workspace-id <your-workspace-id>
```

4. Open [Tailor Platform Console](https://console.tailor.tech/), open GraphQL Playground, and run this query with the token:

```graphql
query {
  listUsers {
    greeting
    names
  }
}
```

## Scripts

In the project directory, you can run:

- `deploy`: Deploy the project to Tailor Platform (`tailor deploy`)
- `format`: Format the code using oxfmt
- `format:check`: Check code formatting using oxfmt
- `lint`: Lint the code using oxlint
- `lint:fix`: Fix linting issues using oxlint
- `typecheck`: Run TypeScript type checks with the content mapper
