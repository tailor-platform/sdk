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

When `transport` is omitted, `createSystemOne()` uses AI Gateway and requires `baseURL`.

## TypeSafe AI transport

Until your AI Gateway supports System One, pass a TypeSafe AI transport to `createSystemOne()`. Store the API key in [Secret Manager](services/secret.md), then retrieve it only inside a resolver, executor, or workflow job:

```typescript
import { createSystemOne, createTypeSafeAITransport } from "@tailor-platform/sdk/ai";
import { secretmanager } from "@tailor-platform/sdk/runtime";

const apiKey = await secretmanager.getSecret("typesafe-ai", "api-key");
if (!apiKey) {
  throw new Error("TypeSafe AI API key is not configured.");
}

const systemOne = createSystemOne({
  transport: createTypeSafeAITransport({ apiKey }),
});

const result = await systemOne.choice({
  state: { subject: "Charged twice", message: "I was charged twice for my order." },
  question: "Which department should handle this ticket?",
  choices: ["billing", "sales", "support"],
});
```

The transport adapts TypeSafe AI responses to the same `choice()`, `boolean()`, and `score()` results used with AI Gateway. For boolean decisions, values with a yes probability of at least `0.5` become `true`. For scores, the level with the highest probability becomes `value`.

Keep this transport on the server because browser code would expose the API key. Direct access also bypasses AI Gateway's workspace authentication, credential management, usage tracking, rate limiting, and audit controls. Once AI Gateway supports System One, remove `transport` and provide the Gateway `baseURL` instead; decision call sites do not need to change.

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

All three methods accept an optional `model` override. When it is omitted, the selected transport uses its default decision model.

Failures throw `SystemOneError` with a provider-independent `code`. Applications can handle stable codes such as `RATE_LIMITED`, `PROVIDER_TIMEOUT`, and `PROVIDER_UNAVAILABLE` without depending on a model provider.
