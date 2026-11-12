---
"@tailor-platform/sdk": minor
---

**Breaking change**: The SDK no longer reads the old environment variable names that printed a deprecation warning. Rename them to the new names:

- `TAILOR_PLATFORM_SDK_CONFIG_PATH` → `TAILOR_CONFIG_PATH`. With only the old name set, `tailor deploy` and `deploy()` use the default config file.
- `TAILOR_TOKEN` → `TAILOR_PLATFORM_TOKEN`. With only the old name set, commands use the token of the profile or the logged-in user.
- `PLATFORM_URL` → `TAILOR_PLATFORM_URL` and `PLATFORM_OAUTH2_CLIENT_ID` → `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`. With only the old names set, commands use the profile's settings or the defaults.

Workflows for several app directories that `tailor setup` generated with `@tailor-platform/sdk-plugin-setup` older than 0.15.0 set `TAILOR_PLATFORM_SDK_CONFIG_PATH`; update `@tailor-platform/sdk-plugin-setup` to 0.15.0 or later, then regenerate them with `tailor setup update`.
