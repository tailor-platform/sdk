---
"@tailor-platform/sdk": major
---

Reject `defineConfig({ env })` values that look like credentials. `env` values are deployed as plaintext, so a token left there is readable by anyone who can read the application's configuration.

```
✖ Secret detected in 'env':
    - env.SLACK_BOT_TOKEN (matched slack)
```

Detection covers the credential formats of common providers (Slack, GitHub, AWS, GCP, Stripe, OpenAI, npm, SendGrid and others). Move such values to `defineSecretManager()`. A value that is only long and random-looking, with no recognizable provider format, is reported as a warning and does not fail the command.

When the detection is wrong about a value, allow it where it is defined and state why it is safe to deploy as plaintext:

```ts
export default defineConfig({
  name: "my-app",
  env: {
    slackRelayUrl: {
      value: process.env.SLACK_RELAY_URL ?? "",
      allowSecret: "Public relay endpoint; the token it proxies stays in Secret Manager.",
    },
  },
});
```

`env` entries therefore accept either a plain `string | number | boolean` or `{ value, allowSecret }`. Application code is unaffected: it still reads `env.slackRelayUrl` as the value itself, and the reason never reaches the deployed application.
