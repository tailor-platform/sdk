# E2E Authentication

Use an existing Tailor SDK login by default. This is an interactive agent workflow, so it may pause
and ask the user to restore authentication.

Official reference: [Tailor SDK user and login commands](https://docs.tailor.tech/sdk/cli/user.html)

## Authentication Order

1. If a trusted caller supplied `TAILOR_PLATFORM_TOKEN`, use it without printing or persisting it.
2. Otherwise run `pnpm exec tailor workspace list`. A config-backed user access token refreshes
   automatically while its refresh token remains valid.
3. If the command reports `Failed to refresh token. Your session may have expired.`, do not assume
   expiry is the only cause; revocation, service errors, and network failures can produce the same
   message. Report the raw error.
4. When login recovery is required, ask the user to run `pnpm exec tailor login`. Browser login
   is a user-only action, then the agent can retry the original verification command.

Never read, copy, print, persist, or edit the refresh token. An environment access token has no
refresh metadata and cannot be renewed by the skill.

## Non-Interactive Requests

Do not replace the user's normal SDK login with a machine-user login as session recovery. It changes
the saved current user and can affect later CLI commands.

If the user explicitly requires a run that cannot pause for browser login, ask for an existing,
approved isolated authentication procedure. Do not accept or invent machine-user credentials,
secret-store commands, or persistent config changes as part of this skill.
