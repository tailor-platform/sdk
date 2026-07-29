---
"@tailor-platform/sdk": major
---

Reject `defineConfig({ env })` values that look like credentials. `env` values are deployed as plaintext, so a token left there is readable by anyone who can read the application's configuration.

```
✖ Secret detected in 'env' in /path/to/tailor.config.ts:
  - env.SLACK_BOT_TOKEN (matched slack)
```

Detection recognizes the credential formats published by common providers, such as Slack, GitHub and AWS. Move such values to `defineSecretManager()`. A value that is only long and random-looking, with no recognizable provider format, is reported as a warning and does not fail the command.

When the detection is wrong about a value, allow it where it is defined and state why it is safe to deploy as plaintext:

```ts
export default defineConfig({
  name: "my-app",
  env: {
    slackRelayUrl: {
      value: process.env.SLACK_RELAY_URL ?? "",
      allowSecretReason: "Public relay endpoint; the token it proxies stays in Secret Manager.",
    },
  },
});
```

`env` entries therefore accept either a plain `string | number | boolean` or, for the string and number values detection can flag, `{ value, allowSecretReason }`. Application code is unaffected: it still reads `env.slackRelayUrl` as the value itself, and the reason never reaches the deployed application.
