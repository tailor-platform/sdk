---
"@tailor-platform/sdk": major
---

Fail `generate` and `deploy` when a `defineConfig({ env })` value looks like a credential. `env` values are deployed as plaintext, so a token left there is readable by anyone who can read the application's configuration.

```
✖ Secret detected in 'env':
    - env.SLACK_BOT_TOKEN (matched slack)
```

Detection covers the credential formats of common providers (Slack, GitHub, AWS, GCP, Stripe, OpenAI, npm, SendGrid and others). Move such values to `defineSecretManager()`. A value that is only long and random-looking, with no recognizable provider format, is reported as a warning and does not fail the command.

Projects that deliberately keep a matching value in `env` can exempt its key with the new `allowEnvSecrets`, which records why the value is safe to deploy as plaintext:

```ts
export default defineConfig({
  name: "my-app",
  env: {
    slackRelayUrl: process.env.SLACK_RELAY_URL ?? "",
  },
  allowEnvSecrets: {
    slackRelayUrl: "Public relay endpoint; the token it proxies stays in Secret Manager.",
  },
});
```

Every exempted key must exist in `env`, so a renamed or deleted key fails instead of leaving a dead exemption behind.
