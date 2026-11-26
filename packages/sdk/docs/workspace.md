---
description: "Declare the services of a whole workspace and the applications that expose them in one tailor.config.ts with defineWorkspace(), or a single application with defineApp(), and deploy, query, and move projects to it."
---

# Workspace Configuration (Beta)

> [!WARNING]
> `defineWorkspace()` and `defineApp()` are **beta**. Their options and behavior may change in a future release.

A `defineConfig()` config describes one application together with the services it deploys. Several applications in one workspace need one config each, and an application borrows a service another config owns by declaring it `external: true`. `defineWorkspace()` instead declares every service of the workspace in one `tailor.config.ts`, keyed by name, and lists for each application which of those services its GraphQL API exposes.

```typescript
import { defineAuth, definePlugins, defineWorkspace } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { user } from "./db/customer/user";

const corpAuth = defineAuth("corp-auth", {
  userProfile: { type: user, usernameField: "email", attributes: { role: true } },
  machineUsers: { "db-seeder": { attributes: { role: "ADMIN" } } },
});

export default defineWorkspace({
  env: { APP_ENV: process.env.APP_ENV ?? "DEV", PAGE_SIZE: 50 },
  db: {
    "customer-db": { files: ["./db/customer/**/*.ts"] },
    "order-db": { files: ["./db/order/**/*.ts"] },
    "ledger-db": { files: ["./db/ledger/**/*.ts"] },
  },
  resolver: {
    "shop-api": { files: ["./apps/shop/resolvers/**/*.ts"] },
    "backoffice-api": { files: ["./apps/backoffice/resolvers/**/*.ts"], env: { PAGE_SIZE: 200 } },
  },
  executor: { files: ["./executors/**/*.ts"] },
  workflow: { files: ["./workflows/**/*.ts"] },
  auth: { "corp-auth": corpAuth },
  apps: {
    shop: { db: ["customer-db", "order-db"], resolver: ["shop-api"], auth: "corp-auth" },
    backoffice: {
      db: ["customer-db", "order-db"],
      resolver: ["backoffice-api"],
      auth: "corp-auth",
      allowedIpAddresses: ["192.168.1.0/24"],
    },
  },
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
```

The file is still named `tailor.config.ts`. The function its default export is made with, `defineConfig()`, `defineApp()`, or `defineWorkspace()`, decides how the SDK reads it. The file holds no workspace ID, so the same file deploys to the workspace of each environment (see [Multi-Environment Configuration](./multi-environment.md)).

## Services and Applications

The top-level keys declare the services the workspace owns:

- `db`, `resolver`: TailorDB and resolver namespaces, keyed by namespace name. A resolver namespace can override `env` values (see [Environment Variables](#environment-variables)).
- `executor`, `workflow`: the executor and workflow files. Executors and workflows belong to the workspace, not to an application.
- `auth`: Auth services, each keyed by the name passed to `defineAuth()`.
- `idp`: built-in IdPs, each keyed by the name passed to `defineIdp()`.
- `staticWebsites`, `aiGateways`, `secrets`, `httpAdapter`, `buildOptions`, `defaultDateRepresentation`, and `maintenanceMode` take the same values as in [`defineConfig()`](./configuration.md). `httpAdapter` requires exactly one application; with several, `deploy` stops with `HTTP_ADAPTER_MULTIPLE_APPLICATIONS`.

Each entry of `apps` is one application, keyed by its name. `db`, `resolver`, `auth`, and `idp` name the services its GraphQL API exposes (`auth` takes one name, the others a list, such as `idp: ["shop-idp"]`), and `cors`, `allowedIpAddresses`, `disableIntrospection`, and `metadata` are its own settings, as described in [Application Settings](./configuration.md#application-settings).

- A name the workspace does not declare is a type error. Loading the config also rejects it with `CONFIG_INVALID`.
- An application lists at least one TailorDB namespace, resolver namespace, IdP, or Auth service.
- Several applications can list the same service.
- A TailorDB namespace that no application lists is in no GraphQL API. Functions still read and write it with `getDB()`, and `tailor generate` writes its types; see [Typed SQL Access](#typed-sql-access).
- TailorDB table names must be unique across the TailorDB namespaces each application lists. Two namespaces that no application lists together, such as those of different applications, can define a table with the same name. Record triggers and `userProfile` then name the namespace of that table (see [Record Triggers](./services/executor.md#record-triggers) and [User Profile](./services/auth.md#user-profile)), and the built-in plugins name it `<namespace>.<Table>` (see [Plugins](./configuration.md#plugins-beta)).

## Environment Variables

The root `env` holds the values every function of the workspace receives, as described in [Environment Variables](./configuration.md#environment-variables). A resolver namespace, `executor`, and `workflow` can each set an `env` that overrides some of those values for their own functions:

```typescript
export default defineWorkspace({
  env: { APP_ENV: "DEV", PAGE_SIZE: 50 },
  resolver: {
    "backoffice-api": { files: ["./apps/backoffice/resolvers/**/*.ts"], env: { PAGE_SIZE: 200 } },
  },
  executor: { files: ["./executors/**/*.ts"], env: { APP_ENV: "DEV-BATCH" } },
  // ...
});
```

- An override can only set keys of the root `env`. Any other key is a type error, and loading the config rejects it with `CONFIG_INVALID`.
- A function receives the root values with its override laid over them, key by key. `tailor function run` and `tailor workflow run` apply the same override as `deploy`.
- The `Env` type in `tailor.d.ts` comes from the root `env` alone, so give an override the same type as the root value it replaces.
- An application has no `env`. `maintenanceMode`, `defaultDateRepresentation`, and `plugins` also apply to the whole workspace.

## Several Auth Services

A workspace can define several Auth services. A machine user is then found by its name across all of them:

- A string `invoker` of a resolver or executor resolves to the Auth service that defines that machine user. When two Auth services define it, `deploy` stops with `INVOKER_MACHINE_USER_AMBIGUOUS`; name the Auth service with `invoker: { namespace: "corp-auth", machineUserName: "db-seeder" }`. `tailor generate` does not check this.
- A string literal `invoker` passed to `workflow.start()` is resolved the same way when `deploy` bundles the function, and an invoker it cannot read, such as a variable, is rejected; see [Starting a Workflow from a Resolver](./services/workflow.md#starting-a-workflow-from-a-resolver).
- An `authAccessToken*Trigger()` needs `auth` to name the Auth service it subscribes to (`EXECUTOR_AUTH_AMBIGUOUS`).
- A TailorDB namespace with migration scripts needs `migration.machineUser` (`MACHINE_USER_REQUIRED`). It takes a machine user name only, so the name must be defined by one Auth service (`MACHINE_USER_AMBIGUOUS`); rename one of the machine users otherwise. See [Machine User and Permissions](./services/tailordb/migration.md#machine-user-and-permissions).
- `Attributes` in `tailor.d.ts` holds the attributes of every Auth service, since a caller may come from any of them. An attribute is optional unless every Auth service requires it.
- On the command line, `--machine-user`, `TAILOR_PLATFORM_MACHINE_USER_NAME`, and a profile's machine user take `<auth>/<name>` to name the Auth service, as in `tailor query -m corp-auth/db-seeder`. A bare name that two Auth services define stops with `MACHINE_USER_AMBIGUOUS`. `tailor oauth2client get` takes `<auth>/<client>` the same way.
- An AI gateway needs `authNamespace` set to one of them.

## IdPs

An application lists at most one IdP in `idp`. Its GraphQL API exposes that IdP's user management operations, whose names are the same for every IdP, so two IdPs cannot share one API. Function code reaches any IdP of the workspace, listed or not, with `new idp.Client({ namespace: "<idp name>" })` from [`@tailor-platform/sdk/runtime`](./runtime.md).

`idpUser*Trigger()` subscribes to any IdP of the workspace. With several IdPs, set `idp` on the trigger (`EXECUTOR_IDP_AMBIGUOUS`).

## GraphQL Operations of Executors

An executor's `graphql` operation runs against the application its `appName` names. With several applications, set `appName`; `deploy` stops with `EXECUTOR_APP_NAME_AMBIGUOUS` otherwise. Without `appName`, a workspace with a single application uses that application, and a workspace without applications stops with `EXECUTOR_APP_NAME_REQUIRED`.

## Typed SQL Access

The `getDB()` that `kyselyTypePlugin` provides covers every TailorDB namespace of the workspace, including those no application lists. To keep the code of one application to its own namespaces, create a narrowed `getDB` and forbid imports of the unrestricted one, as described in [Plugins](./configuration.md#plugins-beta). The narrowing is a type check only: at runtime, every function can reach every namespace.

## Single-Application Projects: `defineApp()`

A project with one application can use `defineApp()`. It takes the options of `defineConfig()` without `id`, without services declared `external`, without the deprecated top-level `inlineSourcemap` and `logLevel` (set them in `buildOptions`), with `idp` as a single IdP, and with `auth` as a single Auth service:

```typescript
import { defineApp } from "@tailor-platform/sdk";
import { auth } from "./auth";
import { idp } from "./idp";

export default defineApp({
  name: "my-app",
  env: { APP_ENV: "DEV" },
  db: { "my-db": { files: ["./db/**/*.ts"] } },
  resolver: { "my-resolver": { files: ["./resolvers/**/*.ts"] } },
  auth,
  idp,
});
```

The SDK reads it as a workspace with one application named `name` that lists every service the config defines. Everything this page says about workspace configs applies to it, except that a resolver namespace, `executor`, and `workflow` cannot override `env`; use `defineWorkspace()` for that.

`deploy` of a `defineApp()` config stops with `DEPLOY_OTHER_CONFIG_RESOURCES` when the workspace holds resources another config deployed, or an application another workspace config deployed, since the deploy would take them over or delete them. Move every config deployed to that workspace into one `defineWorkspace()` config, or give each its own workspace. To rename the application of a `defineApp()` config, deploy once with a `defineWorkspace()` config that lists the new name, then return to `defineApp()`.

## Choosing the Config File

CLI commands use the nearest `tailor.config.ts`, looking in the current directory and then in each parent directory, whichever function it uses. `--config` and `TAILOR_CONFIG_PATH` choose another file. A workspace config is always the only config of a command: `tailor deploy` stops with `DEPLOY_WORKSPACE_CONFIG_WITH_OTHERS` when `--config` also lists other configs.

## Deploying

`tailor deploy` plans and applies the whole workspace in one run; there is no option to deploy one application. Only what changed is applied.

- Every resource the deploy manages carries the label `sdk-managed: workspace`. Each application, and each TailorDB namespace, resolver namespace with its resolver functions, Auth service, and IdP that an application lists, also carries one `sdk-on-app-<application>` label for each application that lists it. Searching the Resources page of the Tailor Platform console for `sdk-on-app-shop`, for example, lists the resources of `shop`.
- A resource holds at most 20 labels. When the `sdk-on-app-*` labels of a resource do not fit, `deploy` writes as many as fit, warns, and completes; with `--json`, the result lists them under `warnings`.
- An application removed from `apps` is deleted. The deletion needs [confirmation](./cli/application.md#deploy), like the deletion of a TailorDB table.
- A service that an application stops listing stays deployed while the workspace declares it; only the application's GraphQL API changes. A service removed from the config is deleted.

### First Deploy After `defineConfig()`

The first deploy of a workspace config to a workspace that `defineConfig()` configs deployed to takes their resources over. It lists the resources it takes over and the ones it deletes because the workspace config does not have them, including executors, resolver namespaces, and IdPs, and asks for confirmation. In a non-interactive environment without `--yes`, it stops with `INTERACTIVE_PROMPT_REQUIRED`.

The workflows that [`tailor setup ci`](./github-actions.md) generates deploy with `--yes`, so in CI the takeover and its deletions go ahead without asking. Check the list in the plan that the pull request workflow posts, or with `tailor deploy --dry-run` locally, before the change reaches the deploy job. Running the first deploy locally lets you answer the prompt yourself.

After the takeover, deploying a `defineConfig()` config to the workspace again asks to take the resources back from the workspace config.

## Commands

- `tailor show` and `tailor open` take `--app` to choose an application. Without it, a workspace with several applications makes `show` list every deployed application, warning about the ones not deployed yet, and `open` opens the workspace's application list.
- `tailor query --engine sql` runs in the namespace `--namespace` names, or in the one namespace that has the table. `--engine gql` runs against the application `--app` names, which a workspace with several applications requires (`CONFIG_APP_REQUIRED`), as a machine user of that application's Auth service.
- `tailor remove` stops with `CONFIG_KIND_UNSUPPORTED`. To remove an application or service, remove it from the config and run `tailor deploy`. To remove everything, run `tailor workspace delete`.
- `tailor machineuser list` and `tailor oauth2client list` list the entries of every Auth service, each with its Auth service.
- `tailor data clone` without `--name` clones the only application; a workspace with several applications needs `--name`. A TailorDB namespace that the cloned application does not list is not cloned.
- `tailor tailordb migration test --data clone` copies one application's data, so it needs a workspace that deploys one application listing every namespace with pending migrations. Use `--data seed` otherwise.
- `tailor setup ci` takes the workspace config's directory as its only `--dir`. A `defineWorkspace()` config needs `--name`; a `defineApp()` config defaults to its application name. The generated workflow generates, checks, plans, and deploys the whole workspace once, and `.github/tailor.lock` records the config under `workspaces`. `--migration-test` needs a config that deploys one application listing every TailorDB namespace with migrations, since the migration test copies that application's data.

Not supported yet for a workspace config:

- `tailor tailordb erd export`, `serve`, and `deploy`, and `tailor setup ci --erd-preview`.
- The built-in seed plugin with several Auth services that use a built-in IdP: `tailor generate` and `tailor deploy` stop with `SEED_IDP_USER_AUTH_AMBIGUOUS`.

## Plugins

`definePlugins()` is exported as `plugins` from the workspace config, as described in [Plugins](./configuration.md#plugins-beta). For what plugin hooks receive from a workspace config, see [Custom Plugins](./plugin/custom.md#workspace-configs-beta).

## Unsupported Setups

- One workspace deployed from several configs or repositories. One `tailor.config.ts` owns the whole workspace: its deploy deletes the resources another config deployed, once it has taken over the workspace.
- Resources created outside the SDK, such as with the console or Terraform, attached with `external: true`. A workspace config declares only services it owns.

## Moving From Several `defineConfig()` Configs

A project that deploys several `defineConfig()` configs to one workspace, with `tailor deploy -c a,b`, a comma-separated `TAILOR_CONFIG_PATH`, or `tailor setup ci` with several `--dir`, moves to one workspace config:

1. Write a `tailor.config.ts` with `defineWorkspace()` at the directory that contains the configs. Move each config's services under the top-level keys, adjusting the paths relative to the old config, such as `files` patterns, `migration.directory`, and plugin `distPath`, to the new directory, and make each config an `apps` entry that lists its services and keeps its `cors`, `allowedIpAddresses`, `disableIntrospection`, and `metadata`. Drop services declared `external`: the config that owns them now declares them once.
2. Merge the `env` of every config into the root `env`. A key with different values in different configs becomes an override on the resolver namespaces, executors, or workflows that need the other value.
3. Name the Auth service, IdP, or application wherever the merge makes a name ambiguous: string `invoker`s and `workflow.start()` invokers, `idpUser*Trigger()` and `authAccessToken*Trigger()` without `idp` or `auth`, `graphql` operations without `appName`, and migrations without `migration.machineUser`. `tailor deploy --dry-run` stops at the first one it finds, so run it again after each fix.
4. Delete the old configs, and their `appIds` entries in `.github/tailor.lock` if the project has one.
5. Run `tailor setup ci` again for the new config with the same `--name` as the existing workflow, so the workflow deploys the new config instead of `TAILOR_CONFIG_PATH`. A new `--name` generates a second workflow; delete the old one with `tailor setup delete`.
6. Run the first deploy as described in [First Deploy After `defineConfig()`](#first-deploy-after-defineconfig).

On the upgrade to v3, [`tailor upgrade`](./cli/upgrade.md) runs the `v3/config-to-workspace` codemod, which does steps 1 to 4 for the configs it finds deployed together. It reports what it leaves for a manual change; configs that set one `env` key differently, for example, stay as they are. Then run `tailor setup update` in place of step 5, and the first deploy. The `v3/config-to-app` codemod rewrites a config deployed on its own to `defineApp()`.
