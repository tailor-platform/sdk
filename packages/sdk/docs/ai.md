# System One

System One makes semantic decisions from application state, a question, and a fixed answer space. It returns the selected answer and its probability without requiring prompt construction or structured-output parsing.

Create a client for your AI Gateway:

```typescript
import { createSystemOne } from "@tailor-platform/sdk/ai";

const systemOne = createSystemOne({
  baseURL: "https://my-aigateway-{WORKSPACE_HASH}.ai.erp.dev",
  token: applicationUserToken,
});
```

External clients pass an application user token. Inside a Tailor Function, resolve the Gateway URL with `aigateway.get()` and omit `token`; the platform authenticates the request:

```typescript
import { createSystemOne } from "@tailor-platform/sdk/ai";
import { aigateway } from "@tailor-platform/sdk/runtime";

const { url } = await aigateway.get("my-aigateway");
const systemOne = createSystemOne({ baseURL: url });
```

## Direct TypeSafe AI access

If your AI Gateway does not yet support System One, call TypeSafe AI directly from server-side code as a temporary integration. Do not set the TypeSafe API URL as `createSystemOne()`'s `baseURL`: TypeSafe AI uses a different request and response format from the AI Gateway System One endpoint.

Install the official client:

```sh
pnpm add @typesafe-ai/sdk
```

Store the TypeSafe API key in [Secret Manager](services/secret.md), then retrieve it only inside a resolver, executor, or workflow job:

```typescript
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import { secretmanager } from "@tailor-platform/sdk/runtime";

const apiKey = await secretmanager.getSecret("typesafe-ai", "api-key");
const client = new TypeSafeClient({ apiKey });

const result = await client.systemOne({
  state: {
    subject: "Charged twice",
    message: "I was charged twice for my order.",
  },
  model: "jev-latest",
  questions: {
    department: choice("Which department should handle this ticket?", {
      billing: null,
      sales: null,
      support: null,
    }),
    urgent: noul("Does this request require urgent handling?"),
    risk: score("Assess the risk of this request.", ["Low risk", "Medium risk", "High risk"]),
  },
});

const department = result.answers.department.choice;
const urgencyProbability = result.answers.urgent.noul;
const riskScore = result.answers.risk.score;
```

TypeSafe calls its boolean primitive `noul`; it returns the probability of a yes answer rather than a boolean value. Its score primitive returns a probability-weighted numeric score, which can fall between the configured levels. These results therefore need a small application-level adapter if the rest of your code expects the `boolean()` and discrete `score()` results documented below.

Keep this integration on the server. The TypeSafe client rejects browser use by default because browser code would expose the API key. Direct access also bypasses AI Gateway's workspace authentication, credential management, usage tracking, rate limiting, and audit controls. Once your AI Gateway supports System One, replace the direct client at this boundary with `createSystemOne()`.

`jev-latest` follows TypeSafe's latest stable model. Pin a versioned model when calibrated thresholds must remain stable across model releases. See the [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [API reference](https://docs.typesafe.ai/api), and [model catalog](https://docs.typesafe.ai/models) for provider-specific behavior.

## Choice decisions

Use `choice()` to select one value from an answer space. Literal types are inferred without `as const`:

```typescript
const result = await systemOne.choice({
  state: { ticket, customer },
  question: "Which department should handle this ticket?",
  choices: ["billing", "sales", "support"],
});

// result.value: "billing" | "sales" | "support"
// result.probabilities: Record<"billing" | "sales" | "support", number>
```

## Boolean decisions

Use `boolean()` for a binary decision:

```typescript
const result = await systemOne.boolean({
  state: invoice,
  question: "Is this invoice a duplicate?",
});

if (result.value && result.probability > 0.95) {
  // Apply the appropriate business rule.
}
```

## Ordered scores

Use `score()` when the answer space has a meaningful order. Levels are ordered from lowest to highest:

```typescript
const result = await systemOne.score({
  state: transaction,
  question: "Assess the risk of this transaction.",
  levels: ["low", "medium", "high"],
});
```

All three methods accept an optional `model` override. When it is omitted, AI Gateway uses its default decision model.

Failures throw `SystemOneError` with a provider-independent `code`. Applications can handle stable codes such as `RATE_LIMITED`, `PROVIDER_TIMEOUT`, and `PROVIDER_UNAVAILABLE` without depending on a model provider.
