---
description: "Make choice, boolean, and ordered score decisions from application state through AI Gateway with the System One client from @tailor-platform/sdk/ai."
---

# System One

System One makes semantic decisions from application state, a question, and a fixed answer space. It returns the selected answer and its probability without requiring prompt construction or structured-output parsing.

Create a client with the URL the platform assigns to your deployed [AI Gateway](services/aigateway.md). Inside a Tailor Function, `aigateway.get()` returns it as `url`. Omit `token`; the platform authenticates the request:

```typescript
import { createSystemOne } from "@tailor-platform/sdk/ai";
import { aigateway } from "@tailor-platform/sdk/runtime";

const { url } = await aigateway.get("my-aigateway");
const systemOne = createSystemOne({ baseURL: url });
```

External clients pass the same URL, which `tailor show` lists, directly with an access token issued by the AI Gateway's auth namespace:

```typescript
import { createSystemOne } from "@tailor-platform/sdk/ai";

const systemOne = createSystemOne({
  baseURL: "https://my-aigateway-{WORKSPACE_HASH}.ai.erp.dev",
  token: accessToken,
});
```

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

Use `boolean()` for a binary decision. `value` is `true` when the probability of "yes" is at least `0.5`, and `probability` is the probability of the selected answer:

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

Use `score()` when the answer space has a meaningful order. Levels are ordered from lowest to highest, and `value` is the level with the highest probability:

```typescript
const result = await systemOne.score({
  state: transaction,
  question: "Assess the risk of this transaction.",
  levels: ["low", "medium", "high"],
});
```

## Models

Decisions use `jev-1.13.0` unless a call passes `model`. `jev-latest` always points to the newest model, so its probabilities can shift when a new model is released. Use it only when your logic does not compare probabilities against fixed thresholds:

```typescript
const result = await systemOne.boolean({
  state: invoice,
  question: "Is this invoice a duplicate?",
  model: "jev-latest",
});
```

## Errors

Failures throw `SystemOneError` with a provider-independent `code`. Applications can handle stable codes such as `UNAUTHORIZED`, `RATE_LIMITED`, `PROVIDER_TIMEOUT`, and `PROVIDER_UNAVAILABLE` without depending on a model provider.

A decision waits until AI Gateway responds. To fail with `PROVIDER_TIMEOUT` instead, pass `timeoutMs`:

```typescript
const systemOne = createSystemOne({ baseURL: url, timeoutMs: 10_000 });
```
