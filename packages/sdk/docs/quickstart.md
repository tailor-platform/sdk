# Quickstart

## Getting Started

In this quickstart tutorial, you'll create an app using the Tailor Platform SDK.
Follow the steps below to get started.

## Prerequisite

You'll need a Tailor account to start using the Tailor Platform.
Contact us [here](https://www.tailor.tech/demo) to get started.

### Install Node.js

The SDK requires Node.js 22 or later. Install Node.js via your package manager by following the official Node.js instructions.

### Create an Example App

The following command creates a new project with the required configuration files and example code.

```bash
npm create @tailor-platform/sdk example-app --template hello-world
```

Before deploying your app, you need to create a workspace:

```bash
npx tailor-sdk login
npx tailor-sdk workspace create --name <workspace-name> --region <workspace-region>
npx tailor-sdk workspace list

# OR
# Create a new workspace using Tailor Platform Console
# https://console.tailor.tech/
```

### Deploy Your App

Run the apply command to deploy your project:

```bash
cd example-app
npm run deploy -- --workspace-id <your-workspace-id>
```

You can now open the GraphQL Playground and execute the `hello` query:

```graphql
query {
  hello(name: "sdk") {
    message
  }
}
```

### Hello World Example

Here's a simple query resolver from the hello-world template:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "hello",
  operation: "query",
  input: {
    name: t.string().description("Name to greet"),
  },
  body: (context) => {
    return {
      message: `Hello, ${context.input.name}!`,
    };
  },
  output: t
    .object({
      message: t.string().description("Greeting message"),
    })
    .description("Greeting response"),
});
```

You can edit `src/resolvers/hello.ts` to customize the message:

```typescript
export default createResolver({
  body: (context) => {
    return {
      message: `Goodbye, ${context.input.name}!`,
    };
  },
});
```

Deploy again to see the response.

## Next Steps

- Learn about [TailorDB](./services/tailordb.md) for database schema definition
- Create custom [Resolvers](./services/resolver.md) with business logic
- Set up [Executors](./services/executor.md) for event-driven automation
- Explore [Templates](../../create-sdk/README.md#available-templates) for more examples
