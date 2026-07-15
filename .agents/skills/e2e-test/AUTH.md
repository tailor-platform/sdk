# E2E Authentication

Keep platform machine-user credentials outside the repository and outside the code under test.

Official references:

- [Tailor SDK user and login commands](https://docs.tailor.tech/sdk/cli/user.html)
- [Tailor Platform workspace permissions](https://docs.tailor.tech/administration/workspace.html)

## Authentication Order

1. If a trusted caller supplied `TAILOR_PLATFORM_TOKEN`, use it without printing or persisting it.
2. Otherwise verify the saved login with `pnpm exec tailor-sdk workspace list`. Config-backed user
   access tokens refresh automatically while their refresh token remains valid.
3. `Failed to refresh token. Your session may have expired.` only proves that the refresh request
   failed. Expiry, revocation, OAuth service errors, and network failures share this message.
4. For interactive recovery, ask the user to run `pnpm exec tailor-sdk login`; browser login is a
   user-only action.
5. For unattended runs, use the isolated machine-user flow below.

An environment token has no refresh metadata and is returned as-is. A saved platform machine-user
login also has no refresh token; mint a new access token from its client credentials before the run.

## Isolated Machine-User Flow

Use a dedicated machine user restricted to disposable test resources. The SDK suite creates and
deletes workspaces, so its credential has destructive capability within its scope. Never grant it
access to production resources.

The client ID and secret must come from an OS keychain or external secret manager. Do not put them
in `ids.local.env`, another repository file, chat, command arguments, shell variables, shell
history, or logs. Use a trusted credential provider that writes exactly
`<client-id>NUL<client-secret>NUL` to standard output without logging either value.

Invoke `/bin/bash`, the helper, the Node.js executable, and the actual `tailor-sdk` JavaScript entry
point from a trusted checkout outside the diff under test. Use absolute paths, and start with an
empty environment so shell and Node.js preload variables cannot run before the helper sanitizes the
login process:

```sh
/usr/bin/env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  TAILOR_PLATFORM_ORGANIZATION_ID="$TAILOR_PLATFORM_ORGANIZATION_ID" \
  TAILOR_PLATFORM_FOLDER_ID="$TAILOR_PLATFORM_FOLDER_ID" \
  /bin/bash /absolute/path/to/trusted-checkout/.agents/skills/e2e-test/scripts/with-machine-user-auth.sh \
  /absolute/path/to/trusted/node /absolute/path/to/trusted/tailor-sdk -- <suite-command> \
  3< <(set +x; /usr/bin/env -i HOME="$HOME" PATH="/usr/bin:/bin" \
    /absolute/path/to/trusted-credential-provider --format=nul)
```

Pass only the non-secret suite IDs that the selected target needs; the example above shows the SDK
suite. Resolve the trusted Node.js path with `mise which node` before loading credentials. Resolve
the CLI package's `bin["tailor-sdk"]` target; do not pass a `.bin` shell shim to Node.js. The provider
must read the two values directly from its secret store; do not wrap it with shell assignments or
`printf ... "$SECRET"`. `set +x` disables caller-side tracing, and the nested `env -i` blocks preload
variables before the provider starts. The values travel only through file descriptor 3, not through
process arguments or the helper's environment.

For example, a macOS Keychain-backed provider can emit two existing generic-password items without
materializing either value in the caller shell:

```sh
set +x
/usr/bin/security find-generic-password -s tailor-e2e-client-id -w | /usr/bin/tr -d '\n'
printf '\0'
/usr/bin/security find-generic-password -s tailor-e2e-client-secret -w | /usr/bin/tr -d '\n'
printf '\0'
```

The helper:

- rejects environment credentials, an invalid credential stream, relative trusted paths, and
  missing commands;
- starts the trusted Node.js and CLI with an allowlisted environment containing only an isolated
  home and the client credentials;
- stores the resulting short-lived access token under a temporary `XDG_CONFIG_HOME`;
- replaces itself with the suite process after removing client credentials and stale token/profile
  overrides, so no long-lived helper retains the secret; and
- uses a credential-free guardian blocked on a lifetime pipe to delete the temporary configuration
  after the suite exits or receives an ordinary termination signal.

The code under test can still read the short-lived access token it needs. Dedicated test-only scope
and prompt workspace cleanup therefore remain mandatory.

For `packages/sdk/e2e`, make the helper's target
`.agents/skills/e2e-test/scripts/run-sdk-e2e.sh`; it performs cleanup while the isolated login is
still available.
