---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-frontend": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Export `defineWorkspace()` and `defineApp()` (beta) from `@tailor-platform/sdk`, with their config types `WorkspaceConfig` and `AppDefinition`. A `defineWorkspace()` config declares every service of a workspace in one `tailor.config.ts` and lists the services each application exposes; `defineApp()` is its single-application form, `defineConfig()` without `id` and `external`. The new Workspace Configuration guide (`docs/workspace.md`) describes how to write, deploy, and move to one.

With such a config:

- `tailor deploy` deploys the whole workspace. Its first deploy over resources that `defineConfig()` configs deployed lists them and asks before taking them over. Installing `@tailor-platform/sdk` writes the config's `tailor.d.ts`.
- `query`, `tailordb truncate`, the `tailordb migration` commands, `function run` and `script`, `workflow run` and `start`, `api`, `seed`, and the `machineuser` and `oauth2client` commands run on it. For the several Auth services such a config can have, a machine user or OAuth2 client can be written as `<auth>/<name>`, `startWorkflow()` and seedPlugin's `machineUserName` take `{ namespace, machineUserName }`, and `loadSeedContext()` returns `resolveMachineUser()` and `appName`.
- `tailor show` and `tailor open` take `--app`, and `tailor show` without it, for a config with several applications, lists the deployed ones and warns about the others. `tailor data clone` clones its only application, and `tailor remove` stops and points to `tailor deploy` and `tailor workspace delete`. For a `defineConfig()` config, `--app` accepts only the config's own name.
- `tailor setup ci` generates one deploy for the whole workspace, records the config under `workspaces` in `.github/tailor.lock`, rejects `--erd-preview`, and takes `--migration-test` only when the config deploys one application that lists every TailorDB namespace with migrations. `tailor setup --seed` reads a seedPlugin `machineUserName` given as `{ namespace, machineUserName }`.

CLI help shows the `<auth>/<name>` form, and the READMEs of the seed, frontend, and TailorDB ERD plugins describe workspace configs.
