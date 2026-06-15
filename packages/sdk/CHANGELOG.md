# @tailor-platform/sdk

## 1.62.0

### Minor Changes

- [#1420](https://github.com/tailor-platform/sdk/pull/1420) [`815a0c8`](https://github.com/tailor-platform/sdk/commit/815a0c8c652be5157c3fe1e1d009f39d57247dbe) Thanks [@dqn](https://github.com/dqn)! - Validate planned resources against platform constraints before applying changes in `deploy`. Constraint violations (such as invalid resource names or out-of-range values) are now reported together before any change is applied, instead of failing one by one during the apply step. The same check runs with `--dry-run`, and `--no-validate` skips it.

- [#1183](https://github.com/tailor-platform/sdk/pull/1183) [`0123147`](https://github.com/tailor-platform/sdk/commit/0123147bb649bf6044fbd371285355ebb60ca5e8) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `tailor-sdk tailordb migration sync <number>`. The new subcommand reconstructs the TailorDB schema snapshot at the given migration number (e.g. `0` for the baseline) and brings the remote in line with it without requiring a `git checkout`. Useful for recovering from drift introduced by an unintended `deploy --no-schema-check`. Before touching the remote, the command verifies that replaying the full migration history reproduces the current local type definitions, and shows the current vs. target migration with warnings about `migrate.ts` scripts that will re-execute or be skipped on the next deploy. After syncing, run `tailor-sdk deploy` to catch up the remaining migrations from the working tree.

### Patch Changes

- [#1408](https://github.com/tailor-platform/sdk/pull/1408) [`6dfa310`](https://github.com/tailor-platform/sdk/commit/6dfa310fef003027a045afba3519c787fa92341c) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix profile-based token resolution being ignored by some commands. The CLI documents that the access token resolves from `--profile`, then `TAILOR_PLATFORM_PROFILE`, then the current login, but `tailordb migration set`/`status` and the `organization` commands skipped profile resolution and always used the current login — pairing one profile's workspace with another user's token. All commands now follow the documented order.

- [#1418](https://github.com/tailor-platform/sdk/pull/1418) [`2c029aa`](https://github.com/tailor-platform/sdk/commit/2c029aa28797477f2f553821f420efa43452d295) Thanks [@dqn](https://github.com/dqn)! - Enable `noUncheckedIndexedAccess` in the SDK package so index accesses are checked at the type level. No behavior change.

- [#1417](https://github.com/tailor-platform/sdk/pull/1417) [`edfb391`](https://github.com/tailor-platform/sdk/commit/edfb39115b1eb3b05ee0e4663c3af5352373d3c1) Thanks [@dqn](https://github.com/dqn)! - Internal cleanup of redundant conditions and optional chains, now enforced by the `typescript/no-unnecessary-condition` lint rule. No behavior change.

## 1.61.0

### Minor Changes

- [#1398](https://github.com/tailor-platform/sdk/pull/1398) [`19fa125`](https://github.com/tailor-platform/sdk/commit/19fa12594cfb82ca01d429300d5703717643a114) Thanks [@dqn](https://github.com/dqn)! - Display folder names alongside workspace names in workspace-related CLI output.

## 1.60.3

### Patch Changes

- [#1405](https://github.com/tailor-platform/sdk/pull/1405) [`585b917`](https://github.com/tailor-platform/sdk/commit/585b91797f68e999b24292e9ae8c70b6b2d72221) Thanks [@dqn](https://github.com/dqn)! - Delete workflow job functions when their owning workflow is removed during deploy.

- [#1410](https://github.com/tailor-platform/sdk/pull/1410) [`65cd4e8`](https://github.com/tailor-platform/sdk/commit/65cd4e8c678ffac6b85a6371376931a403065c0b) Thanks [@toiroakr](https://github.com/toiroakr)! - Add a Multi-Environment Configuration guide covering workspace selection, per-environment config values with env files, runtime `env` forwarding, and settings that belong to a single environment such as custom domains.

## 1.60.2

### Patch Changes

- [#1399](https://github.com/tailor-platform/sdk/pull/1399) [`4b1c61c`](https://github.com/tailor-platform/sdk/commit/4b1c61c51a2c8367ab50b3cd8144a0bfb9074fc1) Thanks [@dqn](https://github.com/dqn)! - Reject duplicate TailorDB type names across application namespaces, including deployed external TailorDB namespaces checked at deploy time. Projects that currently reuse a type name across namespaces will fail validation on the next `generate` or `deploy`; rename the duplicated types before upgrading.

- [#1406](https://github.com/tailor-platform/sdk/pull/1406) [`a10389f`](https://github.com/tailor-platform/sdk/commit/a10389f7498f9817f7dbf235a64496e83e024a85) Thanks [@dqn](https://github.com/dqn)! - Clarify how non-secret runtime `env` values defined in `defineConfig()` are passed to resolvers, executors, workflow jobs, auth hooks, TailorDB migrations, and `function test-run`.

## 1.60.1

### Patch Changes

- [#1356](https://github.com/tailor-platform/sdk/pull/1356) [`be55e45`](https://github.com/tailor-platform/sdk/commit/be55e45ba2a9eeac0d02633aa793a212c8651acf) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update rolldown

- [#1404](https://github.com/tailor-platform/sdk/pull/1404) [`0aa76e9`](https://github.com/tailor-platform/sdk/commit/0aa76e9c25c41b619433838d0848e8e010e2078a) Thanks [@remiposo](https://github.com/remiposo)! - Fix `db.fields.timestamps()` so `updatedAt` is updated on every record update. Since update hooks receive the stored value merged with the input, the previous `value ?? new Date()` fallback froze `updatedAt` at its first value. `createdAt` still respects a user-specified value on create.

## 1.60.0

### Minor Changes

- [#1370](https://github.com/tailor-platform/sdk/pull/1370) [`ca4e049`](https://github.com/tailor-platform/sdk/commit/ca4e0494d8f3069e91e55c0b8ccc15ed1e6b567b) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `authconnection open` command to open the auth connections page in the Tailor Platform Console. The `authconnection authorize` command now also points to this Console flow when the local callback server cannot be started, and the auth connection docs note that managing connections via `tailor.config.ts` is unreliable for shared and CI deploys (a deploy without the local `.tailor-sdk/` secret state recreates the connection and discards its token) — create connections and tokens from the Console instead.

### Patch Changes

- [#1386](https://github.com/tailor-platform/sdk/pull/1386) [`34aba6c`](https://github.com/tailor-platform/sdk/commit/34aba6c66fd60a2614fe37a4eee07b0252592894) Thanks [@toiroakr](https://github.com/toiroakr)! - Stabilize the `withBundleConcurrency` unit tests by driving their worker delays with fake timers instead of real `setTimeout`, so they no longer flake with a 5s timeout when a CI runner is under load. No runtime behavior changes.

## 1.59.0

### Minor Changes

- [#1282](https://github.com/tailor-platform/sdk/pull/1282) [`4660bc8`](https://github.com/tailor-platform/sdk/commit/4660bc8a0c31e52ef7e32f4c325b8aa1c2a2af3a) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(vitest)!: rename mock controllers to verb-style `mockX()` factories (Beta)

  The `@tailor-platform/sdk/vitest` mock controllers are renamed from noun-style
  singleton objects (`tailordbMock`, `workflowMock`, …) to verb-style **factory
  functions** (`mockTailordb`, `mockWorkflow`, `mockSecretmanager`,
  `mockAuthconnection`, `mockIdp`, `mockFile`, `mockIconv`). Acquire one with a
  `using` declaration and its state is reset automatically when the test scope
  exits — no more `beforeEach(() => mock.reset())`.

  ```diff
  -import { tailordbMock } from "@tailor-platform/sdk/vitest";
  -
  -beforeEach(() => tailordbMock.reset());
  -
   test("...", () => {
  -  tailordbMock.enqueueResult({ age: 30 });
  -  expect(tailordbMock.executedQueries).toHaveLength(1);
  +  using db = mockTailordb();
  +  db.enqueueResult({ age: 30 });
  +  expect(db.executedQueries).toHaveLength(1);
   });
  ```

  This is a breaking change to the **Beta** `tailor-runtime` testing API. `using`
  requires TypeScript ≥ 5.2 and a runtime that provides `Symbol.dispose`
  (Node ≥ 20.4; the SDK already targets Node ≥ 22, and Vitest's transformer
  downlevels the syntax).

### Patch Changes

- [#1384](https://github.com/tailor-platform/sdk/pull/1384) [`b5ddf76`](https://github.com/tailor-platform/sdk/commit/b5ddf762bbdbaf22f879aeabbaddb85fa0a57da6) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix flaky `already_exists` failures during `deploy`/`apply` on busy or fresh workspaces. When a resource create succeeds on the platform but its response is lost as `Unavailable`/`ResourceExhausted` under load, the SDK's automatic retry now treats the follow-up `already_exists` as success for the affected apply resource creates instead of failing the deploy. Retry backoff also starts with a longer initial delay so a retry is less likely to race an in-flight request, and the retry path now emits `debug` traces (retries and swallowed `already_exists`) to help diagnose such failures.

- [#1372](https://github.com/tailor-platform/sdk/pull/1372) [`9fdb857`](https://github.com/tailor-platform/sdk/commit/9fdb85746dfb3734014056b57fb95ce1ae21d585) Thanks [@dqn](https://github.com/dqn)! - Fix TailorDB types with a `serial` field inside a nested object being reported as a change on every deploy.

- [#1382](https://github.com/tailor-platform/sdk/pull/1382) [`99e1d79`](https://github.com/tailor-platform/sdk/commit/99e1d791976528d4fec9742cd473ece33a136cb0) Thanks [@toiroakr](https://github.com/toiroakr)! - Treat `console.log` as a DEBUG-level call when bundling deployment functions, matching the platform's OpenTelemetry severity mapping. With `logLevel: "INFO"` or higher, `console.log` calls are now dropped alongside `console.debug`. The default `"DEBUG"` level still keeps all console calls.

- [#1380](https://github.com/tailor-platform/sdk/pull/1380) [`2ed1344`](https://github.com/tailor-platform/sdk/commit/2ed1344e5ffff6e78d74ef3a0297fcff4a6201e7) Thanks [@dqn](https://github.com/dqn)! - Internal refactoring: replace mutating array methods (`sort`/`reverse`/`splice`) with non-mutating ES2023 equivalents (`toSorted`/`toReversed`/`toSpliced`). No user-facing behavior change.

- [#1379](https://github.com/tailor-platform/sdk/pull/1379) [`5299c0c`](https://github.com/tailor-platform/sdk/commit/5299c0c17c6b7ab2febddd84faae39054a234165) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency undici to v8.4.0

- [#1308](https://github.com/tailor-platform/sdk/pull/1308) [`74015e4`](https://github.com/tailor-platform/sdk/commit/74015e47858ad7c8d7ec5d59c06a9fc1ece6504d) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(vitest): run a full workflow locally through `.trigger()` (Beta)

  Calling `workflow.mainJob.trigger()` (or any job's `.trigger()`) now runs the
  real job bodies of the whole chain — no `mockWorkflow()` needed — so you can
  exercise end-to-end orchestration in a unit test without a deployment. Trigger
  inputs and outputs cross the same JSON boundary the platform uses, so a
  non-serializable payload fails the test exactly as it would in production.
  Acquire `mockWorkflow()` only to override individual dependent jobs with
  `wf.setJobHandler(...)` / `wf.enqueueResult(...)` (the rest still run their real
  bodies), set the env via `wf.setEnv(...)`, or assert on `wf.triggeredJobs`.

## 1.58.0

### Minor Changes

- [#1310](https://github.com/tailor-platform/sdk/pull/1310) [`228b244`](https://github.com/tailor-platform/sdk/commit/228b244c9d2c617ac0ca7d2a354cc1cd6606327c) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(cli): add `authconnection delete` and use it during deploy

  `tailor-sdk authconnection delete` removes an auth connection entirely (configuration, secret, and tokens), complementing `tailor-sdk authconnection revoke`, which only invalidates the active session and keeps the connection so it can be re-authorized. `deploy` now uses delete when it replaces or removes the auth connections it manages.

- [#1367](https://github.com/tailor-platform/sdk/pull/1367) [`545f74b`](https://github.com/tailor-platform/sdk/commit/545f74b6af26fbc5d8b4c9e147af9b09fe2e4644) Thanks [@haru0017](https://github.com/haru0017)! - Add `customDomains` option to `defineStaticWebSite()` for associating custom domains with static websites, and `staticwebsite domain get` / `staticwebsite domain list` CLI commands for checking domain status and DNS CNAME targets.

### Patch Changes

- [#1368](https://github.com/tailor-platform/sdk/pull/1368) [`6c143bf`](https://github.com/tailor-platform/sdk/commit/6c143bfb913d8d866442edd6c8f60c02e818e6ba) Thanks [@dqn](https://github.com/dqn)! - Internal refactoring: consolidate the per-resource TRN builder functions and inline `${trnPrefix(...)}:<kind>:<name>` template literals scattered across the deploy commands into a single typed `resourceTrn(workspaceId, kind, name)` helper. No user-facing behavior change.

- [#1376](https://github.com/tailor-platform/sdk/pull/1376) [`cf1d87c`](https://github.com/tailor-platform/sdk/commit/cf1d87cfb6a379bbf1d0448ea0ec306c0dae4611) Thanks [@toiroakr](https://github.com/toiroakr)! - Reword CLI `--help` text and the bundled documentation to describe user-facing behavior instead of internal implementation details. The `api` and `function logs` command notes no longer expose internal terms such as proto/RPC names, the `TestExecScript` API, or bundle sourcemap/content-hash mechanics, and the auth docs drop the internal "SDK vs Platform Naming" note. No runtime behavior changes.

- [#1352](https://github.com/tailor-platform/sdk/pull/1352) [`a3bf971`](https://github.com/tailor-platform/sdk/commit/a3bf9710b337e44b505f0acd6d814821849f4c60) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @clack/prompts to v1.5.1

- [#1353](https://github.com/tailor-platform/sdk/pull/1353) [`f0cfb61`](https://github.com/tailor-platform/sdk/commit/f0cfb61dcadb47819a8916da9bcf9b63a4ff5706) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.2

## 1.57.0

### Minor Changes

- [#1319](https://github.com/tailor-platform/sdk/pull/1319) [`77754c2`](https://github.com/tailor-platform/sdk/commit/77754c264f3a18ccea2fb2ee2a144da4768b09a9) Thanks [@dqn](https://github.com/dqn)! - Replace the Liam-based `tailordb erd` beta commands with a TailorDB-specific ERD viewer generated from local TailorDB schema. `tailordb erd export` writes a single self-contained `index.html` under `<output>/<namespace>/dist` (CSS, JS, and the schema are inlined as separately extractable blocks), `tailordb erd serve` runs a built-in local server with watch reload and `--port` / `--open`, and `tailordb erd deploy` uploads the generated viewer while keeping the existing `erdSite` requirement.

### Patch Changes

- [#1309](https://github.com/tailor-platform/sdk/pull/1309) [`9e4c726`](https://github.com/tailor-platform/sdk/commit/9e4c726c1a84ac70ba7bc74aaf4765173562ed0e) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(cli): track auth connection ownership via platform labels

  `deploy` now tags auth connections with SDK ownership labels and uses them to decide which connections to manage, matching every other auth resource. Connections that are not labeled by the SDK are treated as unowned: they are surfaced in the unmanaged-resource confirmation prompt rather than silently deleted, and once you confirm adoption the SDK label is written even when the connection is otherwise unchanged, so later deploys recognize it as owned. Auth connection deletions are also shown in the deletion confirmation prompt.

## 1.56.1

### Patch Changes

- [#1347](https://github.com/tailor-platform/sdk/pull/1347) [`6888110`](https://github.com/tailor-platform/sdk/commit/6888110fa61f9f3fd991e0fb44e86fd37f9536f3) Thanks [@dqn](https://github.com/dqn)! - Fix resolver field builders (`t.*`) leaking metadata between fields. `description()`, `typeName()`, and `validate()` now return a new field instead of mutating the original, so a field instance reused across places (for example shared between a resolver's `input` and `output`, or a record passed to `t.object`) no longer leaks its metadata into the other usages. This matches the existing `db.*` behavior.

- [#1346](https://github.com/tailor-platform/sdk/pull/1346) [`0254e3c`](https://github.com/tailor-platform/sdk/commit/0254e3caff0d1eeb7407d8932385bf5bdbaf4356) Thanks [@dqn](https://github.com/dqn)! - Warn when a permission rule is written in object form without an explicit `permit`. Object-format rules (e.g. `read: [{ conditions: [...] }]`) default to `deny`, unlike the array shorthand which defaults to `allow`, so omitting `permit` can silently lock out access you meant to grant. The CLI now flags these rules during generate/deploy so you can set `permit: true` (allow) or `permit: false` (deny) explicitly. Runtime behavior is unchanged. This covers TailorDB record permissions, TailorDB GraphQL permissions, and IdP permissions.

## 1.56.0

### Minor Changes

- [#1341](https://github.com/tailor-platform/sdk/pull/1341) [`64b07b4`](https://github.com/tailor-platform/sdk/commit/64b07b4c6f1db868abf2e1ebb9097e0e2f2f3cc6) Thanks [@dqn](https://github.com/dqn)! - Add a `logLevel` config option to remove lower-level `console.*` calls from bundled deployment functions.

### Patch Changes

- [#1345](https://github.com/tailor-platform/sdk/pull/1345) [`ec863f1`](https://github.com/tailor-platform/sdk/commit/ec863f13e7a3ca43e40ad413c1bbe47cd5567c95) Thanks [@dqn](https://github.com/dqn)! - Fix `seed --truncate` deleting only the first page of Built-In IdP `_User` records. The generated truncation script used incorrect pagination keys, so projects with more than one page of users were left with the remaining pages while the command still reported success. All pages are now deleted.

- [#1344](https://github.com/tailor-platform/sdk/pull/1344) [`d3f22da`](https://github.com/tailor-platform/sdk/commit/d3f22da5a9bcd44ca9659ac35a68a20a2cbc1c2a) Thanks [@dqn](https://github.com/dqn)! - Fix CLI auth config losing keyring-stored logins. Running any command without `TAILOR_USE_KEYRING` no longer downgrades `config.yaml` in a way that drops `storage: keyring` users (and dangles their `current_user` reference), which previously logged keyring users out. Configs containing keyring users now stay in V2 format; file-only configs still downgrade to V1 for backward compatibility.

## 1.55.2

### Patch Changes

- [#1190](https://github.com/tailor-platform/sdk/pull/1190) [`6f891e8`](https://github.com/tailor-platform/sdk/commit/6f891e8a0f948ca2b58bb7e1d4ad19efc31cc38c) Thanks [@toiroakr](https://github.com/toiroakr)! - Validate auth service configuration during `deploy` / `generate`, consistent with how IdP, TailorDB, and static websites are already handled. Configs that set both `userProfile` and `machineUserAttributes` now fail with a clearer message: "Specify either `userProfile` or `machineUserAttributes`, not both."

- [#1332](https://github.com/tailor-platform/sdk/pull/1332) [`aa898b7`](https://github.com/tailor-platform/sdk/commit/aa898b7f369c441077973848a92a09152f6bed4f) Thanks [@dqn](https://github.com/dqn)! - Fix `executor get --json` to include typed event trigger metadata such as event types, namespaces, target names, and conditions.

## 1.55.1

### Patch Changes

- [#1333](https://github.com/tailor-platform/sdk/pull/1333) [`46a0f78`](https://github.com/tailor-platform/sdk/commit/46a0f78481f4718a470a2cb5a15298db8015f452) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor-sdk api` injecting a duplicate `workspaceId` when `--body` supplies the field in snake_case. The auto-injection guard only checked the camelCase key, so a body such as `{"workspace_id": "..."}` slipped past it and the SDK appended a second `workspaceId`, which the server rejected with a duplicate-field error. Body keys are now converged to each field's canonical (camelCase) name before injection, so snake_case and JSON aliases are recognized.

- [#1325](https://github.com/tailor-platform/sdk/pull/1325) [`8bd51e6`](https://github.com/tailor-platform/sdk/commit/8bd51e64143a2877dcdc821a57b8b6b82cf61363) Thanks [@dqn](https://github.com/dqn)! - Fix `--json` output for CLI commands that returned human-readable text or empty stdout instead of parseable JSON.

- [#1276](https://github.com/tailor-platform/sdk/pull/1276) [`f1536d6`](https://github.com/tailor-platform/sdk/commit/f1536d64d182c9456692165397a74ad8c0257d30) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxc

- [#1312](https://github.com/tailor-platform/sdk/pull/1312) [`00c9b07`](https://github.com/tailor-platform/sdk/commit/00c9b07fdec9b6fa59026f6d4451d43f04114c55) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer to v8.5.2

- [#1316](https://github.com/tailor-platform/sdk/pull/1316) [`b7f0389`](https://github.com/tailor-platform/sdk/commit/b7f0389270573ba5cf6accca31acdea027974c8d) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency tsx to v4.22.4

- [#1318](https://github.com/tailor-platform/sdk/pull/1318) [`c48aeb6`](https://github.com/tailor-platform/sdk/commit/c48aeb6e72a644b056a48e57d39799cae386461e) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency type-fest to v5.7.0

- [#1328](https://github.com/tailor-platform/sdk/pull/1328) [`8473a4d`](https://github.com/tailor-platform/sdk/commit/8473a4d284cea998759584c151e12c6cb9b7bc67) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency graphql to v16.14.1

## 1.55.0

### Minor Changes

- [#1173](https://github.com/tailor-platform/sdk/pull/1173) [`4d8010d`](https://github.com/tailor-platform/sdk/commit/4d8010ddf93edd1e9e7344b7e868b7e6efc3fddf) Thanks [@Mistat](https://github.com/Mistat)! - Add `createHttpAdapter()` for declaring HTTP adapters that translate HTTP requests into GraphQL queries and reshape the responses. Adapter files are discovered via the new `httpAdapter.files` glob in `defineConfig()`.

### Patch Changes

- [#1320](https://github.com/tailor-platform/sdk/pull/1320) [`977c200`](https://github.com/tailor-platform/sdk/commit/977c2007eb6ac28507d6eac1c391448ab91caa2a) Thanks [@remiposo](https://github.com/remiposo)! - `createKyselyMock`: assert what a write wrote as a `{ column: value }` map instead of positional SQL parameters. On a recorded query:

  - `insertValues()` / `insertRows()` — the values a single- / multi-row insert wrote
  - `updateValues()` — the values an update's SET clause wrote
  - `node` — the raw Kysely operation node, for anything the helpers don't cover

  Also adds `withTx(fn)` to run `fn` inside a real `Transaction`.

- [#1314](https://github.com/tailor-platform/sdk/pull/1314) [`e423765`](https://github.com/tailor-platform/sdk/commit/e4237652c4ac65074e2bcd1da56adc1841bc71cd) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix generated migrate.ts templates for enum value removal: removed enum values were compared by object identity (so unchanged values were also treated as removed) and rendered as `[object Object]` in the generated migration script.

## 1.54.3

### Patch Changes

- [#1293](https://github.com/tailor-platform/sdk/pull/1293) [`1f9991d`](https://github.com/tailor-platform/sdk/commit/1f9991dc089763b9a3dbf95e26742c7100f9dd24) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `db.fields.timestamps()` to respect user-specified `createdAt` / `updatedAt` values instead of always overwriting them with the current time. When a value is provided (e.g. seeding historical records), it is now used; when omitted, the current time is still applied as before.

## 1.54.2

### Patch Changes

- [#1303](https://github.com/tailor-platform/sdk/pull/1303) [`0881adf`](https://github.com/tailor-platform/sdk/commit/0881adf42f99ae812bb861d537e33b9b0e7192af) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(deploy): stop reporting persistent TailorDB type diffs on every `deploy`. Fields without a `description` are emitted as an empty string by the platform but omitted by the local manifest; the comparison now treats an empty-string `description` as unset (same handling as empty `expr`), so unchanged types are no longer flagged as updates on repeated applies.

## 1.54.1

### Patch Changes

- [#1292](https://github.com/tailor-platform/sdk/pull/1292) [`0976bac`](https://github.com/tailor-platform/sdk/commit/0976bac530ecf4f7214f6f69796e98a7bedb3e38) Thanks [@dqn](https://github.com/dqn)! - Update generated shell completions so saved completion files can refresh
  themselves after future SDK upgrades.

  Existing `eval "$(tailor-sdk completion bash)"` and
  `eval "$(tailor-sdk completion zsh)"` setups do not need to change because they
  regenerate completions on every shell startup.

  If you saved a static completion file generated by an older SDK version,
  regenerate that file once:

  ```bash
  # bash
  mkdir -p ~/.local/share/bash-completion/completions
  tailor-sdk completion bash > ~/.local/share/bash-completion/completions/tailor-sdk

  # zsh fpath
  mkdir -p ~/.zsh/completions
  tailor-sdk completion zsh > ~/.zsh/completions/_tailor-sdk

  # fish
  tailor-sdk completion fish --install
  ```

  After that one-time regeneration, saved completion files can self-refresh when
  the `tailor-sdk` binary changes. Open a new shell, or reload your shell
  configuration, after regenerating.

- [#1294](https://github.com/tailor-platform/sdk/pull/1294) [`fd1c5cf`](https://github.com/tailor-platform/sdk/commit/fd1c5cf7f2b1512df4a2798521119658cb6a2088) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix IdP services and OAuth2 clients always being reported as changed on consecutive deployments when a description is omitted

- [#1281](https://github.com/tailor-platform/sdk/pull/1281) [`9711826`](https://github.com/tailor-platform/sdk/commit/971182600b5866cc44194865ae1a308871a8c377) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(cli): `remove` no longer deletes an application matched by name alone. Removal now verifies ownership via `sdk-app-id`/`sdk-name` labels (`isOwnedByApp`), consistent with every other resource type, so a same-named application owned by another user in a shared workspace is left untouched.

- [#1299](https://github.com/tailor-platform/sdk/pull/1299) [`c10681f`](https://github.com/tailor-platform/sdk/commit/c10681fc33211ec7a92a9ea9e61e00ebf0a69862) Thanks [@k1LoW](https://github.com/k1LoW)! - fix(runtime): remove non-existent `updatedAt` field from `idp.User`. The IDP service does not return this field, so the declaration was misleading consumers into expecting an optional timestamp that was always `undefined`.

## 1.54.0

### Minor Changes

- [#1268](https://github.com/tailor-platform/sdk/pull/1268) [`e6b2a23`](https://github.com/tailor-platform/sdk/commit/e6b2a23b99e101cb878d9570e18d9d2fcbc07ac0) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(auth): expose `env` in the `beforeLogin` hook handler

  The `beforeLogin` auth hook handler now receives `env` alongside `claims` and `idpConfigName`, exposing the variables defined in `defineConfig({ env })` (the same values available via `context.env` in resolvers). This lets hooks branch on environment-specific configuration at runtime without relying on `process.env`, which is unavailable in the platform runtime.

- [#1277](https://github.com/tailor-platform/sdk/pull/1277) [`8d05f86`](https://github.com/tailor-platform/sdk/commit/8d05f864bc714f12783f66453791912dae8246a3) Thanks [@remiposo](https://github.com/remiposo)! - Add `createKyselyMock` to `@tailor-platform/sdk/vitest` for unit-testing code that runs Kysely queries. It returns a real Kysely instance whose execution is mocked. You stage the rows each query returns, run your code, then assert what it did — the SQL and parameters of each query, how many `selects`/`inserts`/`updates`/`deletes` ran, and the value your code returned.

  ```ts
  import { createKyselyMock } from "@tailor-platform/sdk/vitest";
  import type { Namespace } from "./generated/db";

  const mock = createKyselyMock<Namespace["main-db"]>();
  mock.enqueueResults([{ age: 30 }]); // the next query returns this row

  const { age } = await mock.db
    .selectFrom("User")
    .select("age")
    .where("email", "=", "a@b.com")
    .executeTakeFirstOrThrow();
  await mock.db
    .updateTable("User")
    .set({ age: age + 1 })
    .where("email", "=", "a@b.com")
    .execute();

  expect(mock.updates).toHaveLength(1);
  expect(mock.updates[0].parameters).toEqual([31, "a@b.com"]); // the actual bound values
  expect(mock.updates[0].sql).toContain('update "User"'); // the compiled SQL
  ```

- [#1269](https://github.com/tailor-platform/sdk/pull/1269) [`a230ba6`](https://github.com/tailor-platform/sdk/commit/a230ba6a1b6861f60e6edac82ae59d333f1f3604) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(migration): expose `env` in migration scripts

  The migration `main` function now receives an optional second argument `{ env }: MigrationContext` exposing the variables defined in `defineConfig({ env })` — the same values available via `context.env` in resolvers and `{ env }` in workflow jobs. The values are injected at bundle time and the `MigrationContext` type is exported from the generated `./db`. Existing `main(trx)` scripts continue to work unchanged.

### Patch Changes

- [#1285](https://github.com/tailor-platform/sdk/pull/1285) [`239b146`](https://github.com/tailor-platform/sdk/commit/239b1466ab4fb91d416d7cecb606703b5f9a9a33) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer

- [#1288](https://github.com/tailor-platform/sdk/pull/1288) [`02027b1`](https://github.com/tailor-platform/sdk/commit/02027b1d71120ca50e06dea1060d03c39bec41f7) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @clack/prompts to v1.5.0

- [#1291](https://github.com/tailor-platform/sdk/pull/1291) [`6f52e3e`](https://github.com/tailor-platform/sdk/commit/6f52e3e8b385ab00e010fd5bbc4f8bd5f15167be) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency date-fns to v4.4.0

## 1.53.0

### Minor Changes

- [#1275](https://github.com/tailor-platform/sdk/pull/1275) [`f650615`](https://github.com/tailor-platform/sdk/commit/f6506158cd7247b4198a76702044346fbb65c669) Thanks [@haru0017](https://github.com/haru0017)! - Add downloadStream and uploadStream to file api. Mark openDownloadStream as deprecated.

### Patch Changes

- [#1263](https://github.com/tailor-platform/sdk/pull/1263) [`c7e065e`](https://github.com/tailor-platform/sdk/commit/c7e065e1213630e5cb77d7067907b35296f98097) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency undici to v8

- [#1271](https://github.com/tailor-platform/sdk/pull/1271) [`73ab0e0`](https://github.com/tailor-platform/sdk/commit/73ab0e0baf1657b1e916444c77f621823e917b52) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update rolldown

- [#1274](https://github.com/tailor-platform/sdk/pull/1274) [`11b280a`](https://github.com/tailor-platform/sdk/commit/11b280a8e69feeb7973bcc9a6cbe711252ce72fd) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxc

## 1.52.0

### Minor Changes

- [#1195](https://github.com/tailor-platform/sdk/pull/1195) [`e4c3c9a`](https://github.com/tailor-platform/sdk/commit/e4c3c9a03e7711d3478a7399e1eac2c5a633baa1) Thanks [@dqn](https://github.com/dqn)! - Add `--field key=value` (`-f`) to `tailor-sdk api <endpoint>` for setting request-body fields without writing JSON. Dotted keys build nested objects (`-f application.name=foo`), `--field` overrides matching keys in `--body`, and field names tab-complete from the endpoint's proto schema (bash / zsh / fish) — including step-by-step completion of nested message fields.

- [#1186](https://github.com/tailor-platform/sdk/pull/1186) [`57e00d6`](https://github.com/tailor-platform/sdk/commit/57e00d6bfc2f9602af0ac9c0235da6ec0e04b12e) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `workflowMock.setEnv()` to control the `env` value passed to job bodies when `createWorkflowJob().trigger()` is invoked locally. Tests using the `tailor-runtime` Vitest environment can now configure the env through the same `workflowMock` helper they use for `setJobHandler` / `setWaitHandler`, without touching `process.env`.

  ```typescript
  import { workflowMock } from "@tailor-platform/sdk/vitest";

  afterEach(() => workflowMock.reset());

  test("workflow.mainJob.trigger() executes all jobs", async () => {
    workflowMock.setEnv({ STAGE: "test" });
    await workflow.mainJob.trigger({ orderId: "order-1", amount: 100 });
  });
  ```

  The previous env-var-based pattern is now deprecated. A non-breaking fallback is retained, but `workflowMock.setEnv()` takes priority when both are set.

### Patch Changes

- [#1195](https://github.com/tailor-platform/sdk/pull/1195) [`0646e0a`](https://github.com/tailor-platform/sdk/commit/0646e0ad33142bbe89842ec323a66422d8a6a83e) Thanks [@dqn](https://github.com/dqn)! - Make `tailor-sdk api --field` tab completion faster by pre-enumerating candidates into the generated shell script. Field names, enum values, and `true`/`false` for bool fields are now resolved from a static lookup table at TAB time instead of spawning a Node process per keystroke.

- [#1270](https://github.com/tailor-platform/sdk/pull/1270) [`fb540fa`](https://github.com/tailor-platform/sdk/commit/fb540fab090d8f5909804b9189aa97670c892e7b) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(tailordb): set the migration label to `0000` on the first apply

  The initial schema snapshot (`0000`) is deployed through the normal
  create-update flow and never reports itself as a pending migration, so the
  first `tailor-sdk deploy` after `tailordb migration generate` previously left
  the namespace without an `sdk-migration` label. This forced a redundant
  apply/generate/apply sequence to establish the baseline. The migration label is
  now reconciled to the latest local migration after every create-update apply, so
  a single `migration generate` + `deploy` establishes the baseline as documented.

- [#1222](https://github.com/tailor-platform/sdk/pull/1222) [`b9ac1da`](https://github.com/tailor-platform/sdk/commit/b9ac1da45365c5f16bed4f28df3920d009893f79) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.29.2

- [#1237](https://github.com/tailor-platform/sdk/pull/1237) [`eb362d6`](https://github.com/tailor-platform/sdk/commit/eb362d63cc6c39b2d8d2706b67c5e38cdc5fda37) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.2

- [#1250](https://github.com/tailor-platform/sdk/pull/1250) [`1a6ab51`](https://github.com/tailor-platform/sdk/commit/1a6ab51f85c5eb15fd0e9526029f9ab9e1eac759) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxc

- [#1257](https://github.com/tailor-platform/sdk/pull/1257) [`6b3b48e`](https://github.com/tailor-platform/sdk/commit/6b3b48e11b1b67aff9f9e15ad818f8a2587591bf) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer

- [#1259](https://github.com/tailor-platform/sdk/pull/1259) [`a31c292`](https://github.com/tailor-platform/sdk/commit/a31c292a65e30f150778377ab4f06f003f8eeda7) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency es-toolkit to v1.47.0

- [#1261](https://github.com/tailor-platform/sdk/pull/1261) [`f6de6cf`](https://github.com/tailor-platform/sdk/commit/f6de6cf7fbc3c9d56c75e297ef2f374b2b83337c) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency undici to v6.26.0

## 1.51.2

### Patch Changes

- [#1252](https://github.com/tailor-platform/sdk/pull/1252) [`631dfe0`](https://github.com/tailor-platform/sdk/commit/631dfe03022574c003918621c5a9395d79e6394f) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor-sdk api <endpoint>` writing its JSON response to stderr instead of stdout. The response now goes to stdout (matching `api list` / `api inspect`), so `-j` output can be piped to other tools.

- [#1244](https://github.com/tailor-platform/sdk/pull/1244) [`ce749ad`](https://github.com/tailor-platform/sdk/commit/ce749ad02947cacfbfaab2169e9a6522d11abc70) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency date-fns to v4.3.0

- [#1245](https://github.com/tailor-platform/sdk/pull/1245) [`261a49d`](https://github.com/tailor-platform/sdk/commit/261a49de5d30d3a427a8a484956aa10ee6576abf) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency semver to v7.8.1

- [#1248](https://github.com/tailor-platform/sdk/pull/1248) [`a7fc33e`](https://github.com/tailor-platform/sdk/commit/a7fc33e6ce084f6a91210685b29cc9b65b9704c4) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency tsx to v4.22.3

## 1.51.1

### Patch Changes

- [#1241](https://github.com/tailor-platform/sdk/pull/1241) [`4c40f74`](https://github.com/tailor-platform/sdk/commit/4c40f741318cdbc940a1b7db288751de50e8f680) Thanks [@remiposo](https://github.com/remiposo)! - `tailor-sdk deploy` now waits for the application's GraphQL schema composition to succeed before returning. Composition errors that previously only surfaced via `tailor-sdk workspace app health` are now raised by `deploy` itself.

- [#1216](https://github.com/tailor-platform/sdk/pull/1216) [`7f3aa30`](https://github.com/tailor-platform/sdk/commit/7f3aa308732ac4cac4c8671ce57733a8328d37d9) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @clack/prompts to v1.4.0

- [#1219](https://github.com/tailor-platform/sdk/pull/1219) [`77bf0b7`](https://github.com/tailor-platform/sdk/commit/77bf0b71a1f92be4987be5ab344cecc9985c88a2) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency globals to v17.6.0

- [#1220](https://github.com/tailor-platform/sdk/pull/1220) [`36b3bce`](https://github.com/tailor-platform/sdk/commit/36b3bceca39899c8fb0d57b4c0d467c2f0fe491e) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency graphql to v16.14.0

- [#1249](https://github.com/tailor-platform/sdk/pull/1249) [`2e11bc2`](https://github.com/tailor-platform/sdk/commit/2e11bc28e76fca4874b9d35454e86253ca53b920) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency zod to v4.4.3

- [#1246](https://github.com/tailor-platform/sdk/pull/1246) [`4d3f2d4`](https://github.com/tailor-platform/sdk/commit/4d3f2d4eb7d5f1a7bdcd3a078075f89d4b2048ab) Thanks [@toiroakr](https://github.com/toiroakr)! - Cap parallel bundling of resolvers, executors, and workflow jobs to avoid OOM/SIGTERM on CI runners with many resolvers. Concurrency defaults to `os.cpus().length` and can be overridden via the `TAILOR_BUNDLE_CONCURRENCY` env var.

## 1.51.0

### Minor Changes

- [#1131](https://github.com/tailor-platform/sdk/pull/1131) [`c62c3b0`](https://github.com/tailor-platform/sdk/commit/c62c3b0a78761cff859ccac5af23d2e8dd0f996a) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `@tailor-platform/sdk/runtime` — typed wrappers for the Tailor Platform Function runtime APIs (`tailor.iconv`, `tailor.secretmanager`, `tailor.authconnection`, `tailor.idp`, `tailor.workflow`, `tailor.context`, and `tailordb.file`). The wrappers and their types are fully self-contained, so you can use them without activating any ambient globals.

  ```ts
  import {
    iconv,
    secretmanager,
    idp,
    file,
  } from "@tailor-platform/sdk/runtime";

  const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");
  const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");
  const client = new idp.Client({ namespace: "my-namespace" });
  const { metadata } = await file.upload(
    "ns",
    "Document",
    "attachment",
    recordId,
    bytes
  );
  ```

  The SDK no longer depends on the external `@tailor-platform/function-types` package; its declarations are now vendored inside the SDK. For backwards compatibility the ambient `tailor.*` / `tailordb.*` types are still activated automatically when you import from `@tailor-platform/sdk`, so existing code keeps type-checking with no changes. This implicit activation will be removed in v2.0 — new code is encouraged to use the typed wrappers from `@tailor-platform/sdk/runtime`, or to opt into the globals explicitly via `import "@tailor-platform/sdk/runtime/globals"` (or by listing the entry in `tsconfig.json`'s `compilerOptions.types`).

  The capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`) is preserved as a `@deprecated` alias of the new lowercase `tailordb.*` namespace for source-level compatibility with `@tailor-platform/function-types`. It will be removed in v2.0; run `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` to migrate. The `@tailor-platform/function-types` declarations are vendored inside the SDK and activated automatically, so you can simply remove `@tailor-platform/function-types` from your `package.json` (and from `tsconfig.json` `compilerOptions.types` if listed) once you've upgraded.

  Other test-mock changes from `@tailor-platform/sdk/vitest`:

  - Breaking: when an `openDownloadStream` (or `toFileStream()`) call consumes a queued mock result, raw `Uint8Array` / `ArrayBuffer` payloads are now rejected. Enqueue a structured iterable of `StreamValue` items (`{ type: "metadata" }`, `{ type: "chunk", data, position }`, `{ type: "complete" }`) so test streams stay aligned with the platform's structured stream contract. The shorthand `Uint8Array` enqueue is still accepted by `download` / `downloadAsBase64`.

### Patch Changes

- [#1215](https://github.com/tailor-platform/sdk/pull/1215) [`65ffd8a`](https://github.com/tailor-platform/sdk/commit/65ffd8a84c377fe91f7632784716a6322fab4c33) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @opentelemetry

- [#1199](https://github.com/tailor-platform/sdk/pull/1199) [`1b6d0d8`](https://github.com/tailor-platform/sdk/commit/1b6d0d8678d02ed6f6ea79dad48fc3ba23978fbe) Thanks [@toiroakr](https://github.com/toiroakr)! - **Fix**: `tailor-sdk tailordb truncate` and the `exec.mjs` generated by the built-in `seedPlugin` no longer touch namespaces declared with `{ external: true }`.

  - `tailor-sdk tailordb truncate --all` now only truncates namespaces the current app actually owns; namespaces declared with `{ external: true }` are skipped. This also covers the `--truncate` path of `seed/exec.mjs`, so its `seed:reset` no longer wipes a sibling app's data.
  - `tailor-sdk tailordb truncate --namespace <name>` now rejects an external namespace with a dedicated error pointing the user to the owning app, instead of the generic "not found in config" message.
  - The generated `seed/exec.mjs` now starts with an `@generated` header to discourage hand-edits, since the entire file is regenerated on every `sdk generate`.

## 1.50.1

### Patch Changes

- [#1226](https://github.com/tailor-platform/sdk/pull/1226) [`d900ddc`](https://github.com/tailor-platform/sdk/commit/d900ddcba170a5effe2119fb37e3e038d5cd5935) Thanks [@remiposo](https://github.com/remiposo)! - Fix `deploy` to no longer delete the application when its `id` is regenerated
  (e.g. CI working tree without a committed `id` in `tailor.config.ts`).

## 1.50.0

### Minor Changes

- [#1223](https://github.com/tailor-platform/sdk/pull/1223) [`c2f078d`](https://github.com/tailor-platform/sdk/commit/c2f078d6fb82d42bcc8c040e020b34072a2d2eb6) Thanks [@toiroakr](https://github.com/toiroakr)! - Improve `tailordb migration` handling of data-loss-possible changes:

  - Removed fields (`field_removed`) and removed types (`type_removed`) are now reported as **warnings** during `tailordb migration generate`, not silent changes. They are no longer dropped before `migrate.ts` runs: the field/type stays available during the Pre-migration phase so that scripts can read it (e.g. `innerJoin` through a foreign key that is being dropped in the same migration), then the physical drop happens in the Post-migration phase.
  - Add `tailordb migration script <number>` subcommand to add a `migrate.ts` (and `db.ts`) template to an existing migration directory. Useful for warning-tier changes where you want a custom data migration even though one was not generated automatically.
  - `migrate.ts` is now executed whenever the file exists on disk for a pending migration, regardless of whether the diff originally required a script. Breaking changes still hard-require a script as before.

### Patch Changes

- [#1194](https://github.com/tailor-platform/sdk/pull/1194) [`4c227cc`](https://github.com/tailor-platform/sdk/commit/4c227cc404e51331c0514b0aaa07d96d8940c347) Thanks [@toiroakr](https://github.com/toiroakr)! - Colocate `src/vitest/` tests next to their sources (drop the
  `src/vitest/__tests__/` directory). Vitest discovers the test files
  via the existing `**/?(*.)+(spec|test).ts` include pattern, so the
  `**/__tests__/**/*.ts` entry has been removed from `vitest.config.ts`.
  The nested integration runner moves from
  `src/vitest/__tests__/integration/` to `src/vitest/integration/`. Pure
  refactor: no public API or behavior changes.

- [#1207](https://github.com/tailor-platform/sdk/pull/1207) [`c0b392d`](https://github.com/tailor-platform/sdk/commit/c0b392d95f81bcb2a4bfd9e856183222da87ef06) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor deploy` so an intermediate migration's data script can still read fields that a later migration removes. Each migration's pre/post phase now submits the schema state reconstructed up to that migration (initial baseline + diffs through N), instead of the FINAL post-all-migrations schema. Previously, removals declared in later migrations leaked into earlier migrations' pre-phase and caused `field 'X' not found` failures at script execution time.

- [#1208](https://github.com/tailor-platform/sdk/pull/1208) [`59d7e0e`](https://github.com/tailor-platform/sdk/commit/59d7e0e7c1b42dcd1571365780114d596e44350c) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(skills): rename bundled skill directory to `agent-skills/` so `gh skill install tailor-platform/sdk` resolves a single skill. `gh skill` uses a recursive `**/skills/*/SKILL.md` match and was picking up both `skills/tailor-sdk/` (the public mirror) and `packages/sdk/skills/tailor-sdk/` (the npm bundle), erroring with conflicting names. The bundled copy is now under `packages/sdk/agent-skills/` (excluded from gh's match), while the repo-root `skills/` mirror remains the single discovery target for `gh skill install` and `npx skills add <repo>`. `npx tailor-sdk skills install` continues to work via the bundled `agent-skills/` path inside the published package.

- [#1217](https://github.com/tailor-platform/sdk/pull/1217) [`b827cf9`](https://github.com/tailor-platform/sdk/commit/b827cf95c0c048959c269f7ed9a31fdc81a5eb13) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @toiroakr/read-multiline to v0.4.1

- [#1184](https://github.com/tailor-platform/sdk/pull/1184) [`dee2ad7`](https://github.com/tailor-platform/sdk/commit/dee2ad7199b2da238b7e9edea2d9bb9605033456) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor deploy` so decimal fields without an explicit `scale` no longer show spurious drift against the platform (which materializes the default `6`). Deploy now plans and applies through the same snapshot pipeline as `tailordb migrate`.

## 1.49.0

### Minor Changes

- [#1147](https://github.com/tailor-platform/sdk/pull/1147) [`f0de80a`](https://github.com/tailor-platform/sdk/commit/f0de80ac83a3e76bcb65be7957cb3d7bd1f80ec1) Thanks [@dqn](https://github.com/dqn)! - Add `--permission <write|read>` flag to `profile create`, `profile update`, and `workspace create` (when `--profile-name` is given) so editor users can use a viewer-style profile by default. Profiles created with `--permission read` block platform-state mutations driven by the operator's bearer token (`apply`, `remove`, `workspace create/delete/restore`, `secret create/update/delete`, `tailordb migrate set`, `tailordb truncate`, `tailordb erd deploy`, `executor trigger`, `staticwebsite deploy`, `authconnection authorize/revoke`, organization / folder / PAT / workspace-user mutations, and direct `api <endpoint>` calls) with a `PROFILE_READONLY` error. Application-data operations executed under a machine user (`query`, `workflow start/resume`, `function test-run`) are not gated because the machine user's own permissions already govern those mutations. Switch profile or run `profile update <name> --permission write` to lift the restriction. Profile management itself stays available so the flag can always be cleared. `profile update` skips remote user / workspace validation when only `--permission` is changing, so the flag can be cleared offline or with an expired token.

  The guard activates only when a profile is in scope: pass `--profile <name>` or set `TAILOR_PLATFORM_PROFILE`. `TAILOR_PLATFORM_TOKEN` and `--workspace-id` direct access bypass the guard by design; they are intended for machine-user / CI flows where the platform token already encodes the permitted scope.

### Patch Changes

- [#1204](https://github.com/tailor-platform/sdk/pull/1204) [`6b1bbcb`](https://github.com/tailor-platform/sdk/commit/6b1bbcbe843340a912a3c75c2ecdb03c5697f967) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.1

- [#1196](https://github.com/tailor-platform/sdk/pull/1196) [`c9b7d1e`](https://github.com/tailor-platform/sdk/commit/c9b7d1eae8a3cccf70191bd8c228cd11db6ed060) Thanks [@dqn](https://github.com/dqn)! - Eliminate the Node.js `DEP0205` `DeprecationWarning` (`` `module.register()` is deprecated. Use `module.registerHooks()` instead. ``) printed by every `tailor-sdk` CLI invocation on Node v26. The CLI now registers `tsx` through its own programmatic API (`tsx/esm/api`) instead of calling `node:module`'s `register("tsx", …)` directly, which on tsx 4.21.1+ routes through `module.registerHooks()` on Node ≥ 24.11.1 / 25.1 / 26 and falls back to `module.register()` on older runtimes. Bumps the bundled `tsx` from 4.21.0 to 4.21.1.

- [#1179](https://github.com/tailor-platform/sdk/pull/1179) [`f72ffe1`](https://github.com/tailor-platform/sdk/commit/f72ffe1aed824eb9af5e7520529c3ebde029b5a6) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor-sdk deploy --no-schema-check` to reconcile the TailorDB migration label to the working tree's latest migration number when it completes. Previously, running `deploy --no-schema-check` from a revision whose working tree is older than the remote left the remote migration label stale; the next `deploy` then reconstructed a snapshot at a label that no longer existed in the working tree and aborted with a false "Remote schema drift detected" error.

## 1.48.0

### Minor Changes

- [#1118](https://github.com/tailor-platform/sdk/pull/1118) [`5ef8e01`](https://github.com/tailor-platform/sdk/commit/5ef8e01fbcee428d77925662006fd2cc7f64a522) Thanks [@toiroakr](https://github.com/toiroakr)! - Detect app renames via a stable, auto-injected `id` field in `tailor.config.ts`.

  The SDK now writes a generated `id: "<uuid>"` field into the
  `defineConfig({...})` call on first `deploy`, and stamps every managed
  resource with an `sdk-app-id` metadata label. Subsequent deploys identify
  ownership by the stable id rather than by the app name, so renaming the
  app (or any of its resources) cleanly removes the old resources before
  creating the new ones. The id is a plain UUID; the SDK adds the
  label-compatible `app-` prefix internally at the metadata boundary.

  Deleting the `id` field regenerates a new UUID on the next `deploy` —
  typically done after copying `tailor.config.ts` from another project so
  the new application does not share the original's id. Existing
  resources keep their data and are re-tagged in place; `deploy` shows a
  dedicated confirmation prompt for this case ("Application id was
  regenerated for ..."), separate from the rename/transfer confirmation.

  If your `tailor.config.ts` is a wrapper that re-exports `defineConfig` from
  another file, the SDK skips id injection on the wrapper — add the `id`
  field manually to the file that contains the actual `defineConfig({...})`
  call. Existing deployments without the id continue to work and migrate
  transparently on the next `deploy` run.

- [#1156](https://github.com/tailor-platform/sdk/pull/1156) [`4311e05`](https://github.com/tailor-platform/sdk/commit/4311e05d59f2e4b92d312b2a0e991f69553c741c) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `disableIdpUserSync` option to `seedPlugin` for opting out of the
  `_User <-> userProfile` foreign keys emitted into the generated seed schema.

  The seed plugin emits two foreign keys when `auth.userProfile` is configured
  so that `validate` rejects rows on either side that lack a matching
  counterpart:

  - `_User.name → <userProfile>.<usernameField>` (`idpToUser`)
  - `<userProfile>.<usernameField> → _User.name` (`userToIdp`)

  Both are emitted by default, matching the previous behavior. Neither
  direction is enforced by the runtime, so it can be useful to relax one when
  seeding asymmetric production-like states such as
  invited-but-not-registered users.

  ```ts
  // Allow seeding invited userProfile rows without a _User row
  seedPlugin({
    distPath: "./seed",
    disableIdpUserSync: { userToIdp: true },
  }),

  // Allow seeding _User rows whose userProfile row does not exist yet
  seedPlugin({
    distPath: "./seed",
    disableIdpUserSync: { idpToUser: true },
  }),
  ```

### Patch Changes

- [#1189](https://github.com/tailor-platform/sdk/pull/1189) [`7bcd9c1`](https://github.com/tailor-platform/sdk/commit/7bcd9c14eaed52df95b4a6523804a8a971797473) Thanks [@toiroakr](https://github.com/toiroakr)! - Improve tree-shaking of `@tailor-platform/sdk` so applications that only import a subset of the public API ship less unused code:

  - Add a selective `sideEffects` allow-list to `package.json`: only `dist/cli/*.mjs` and `dist/vitest/setup.mjs` retain side effects, the rest of `dist/` is marked side-effect-free so bundlers can drop modules whose only imports are unused.
  - Replace the top-level `export const t = { ..._t }` spread in `configure/index.ts` with a direct alias, eliminating a side-effecting object construction that prevented elimination of unused field builders.
  - Annotate configure-layer factories (`defineConfig`, `defineAuth`, `defineIdp`, `defineStaticWebSite`, `definePlugins`, `createResolver`, `createExecutor`, `createWorkflow`, `createWorkflowJob`, etc.) with `@__NO_SIDE_EFFECTS__` so calls whose return values are unused can be eliminated.

  No public API surface changes.

- [#1180](https://github.com/tailor-platform/sdk/pull/1180) [`3411070`](https://github.com/tailor-platform/sdk/commit/34110703daa5cafa40958f5b9dc6f21df5e201fb) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer

- [#1191](https://github.com/tailor-platform/sdk/pull/1191) [`a20354d`](https://github.com/tailor-platform/sdk/commit/a20354d47211e1955acd9086c4d25228ee2873de) Thanks [@dqn](https://github.com/dqn)! - **Security**: Harden permissions of the CLI config file (`~/.config/tailor-platform/config.yaml`) and local crash reports to `0o600`, with their parent directory at `0o700`. Previously these files inherited the user's `umask` (typically `0o644`), so on multi-user hosts or shared CI volumes other accounts could read access/refresh tokens stored in the config when the OS keyring is unavailable, as well as crash payloads.

  **Action recommended**: If you have used the CLI on a multi-user host or in a shared CI environment, upgrade and run any `tailor-sdk` command once to auto-tighten existing files, or manually:

  ```sh
  chmod 700 ~/.config/tailor-platform
  chmod 600 ~/.config/tailor-platform/config.yaml
  ```

  POSIX-only; on Windows the mode bits are best-effort and ACLs continue to govern access.

## 1.47.1

### Patch Changes

- [#1176](https://github.com/tailor-platform/sdk/pull/1176) [`5abed20`](https://github.com/tailor-platform/sdk/commit/5abed20dff48e24f23675989143e33c8afb23845) Thanks [@toiroakr](https://github.com/toiroakr)! - Declare `undici` as a direct dependency. The SDK CLI imports `getGlobalDispatcher` from `undici`, but the package was previously available only through accidental hoisting of a transitive dependency. Strict node_modules layouts (e.g. pnpm 11 with stricter hoisting) would fail to resolve the import; declaring it directly fixes that.

- [#1172](https://github.com/tailor-platform/sdk/pull/1172) [`7f37a07`](https://github.com/tailor-platform/sdk/commit/7f37a076a281fdca03d2301e1dba95668b2f7222) Thanks [@toiroakr](https://github.com/toiroakr)! - Widen `TailorEnv` fallback to `Record<string, string | number | boolean>` so it matches the values the type generator emits (string literal / number / boolean). Previously the fallback was `Record<string, string>`, which rejected number and boolean env values until `tailor.d.ts` was generated.

- [#1161](https://github.com/tailor-platform/sdk/pull/1161) [`3e835c5`](https://github.com/tailor-platform/sdk/commit/3e835c55e27fbfedff94a169d1c2fb3c4f50e0a3) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update rolldown

- [#1165](https://github.com/tailor-platform/sdk/pull/1165) [`f4ff7bd`](https://github.com/tailor-platform/sdk/commit/f4ff7bd5318be0a1142a557c76a17896d9df193a) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix a type/runtime mismatch where calling `workflowJob.trigger()` without `await` returned a raw value at runtime even though the static type is `Promise<Awaited<Output>>`. The bundler now wraps `.trigger()` in an async IIFE (`(async () => tailor.workflow.triggerJobFunction("...", args))()`), so the returned value is always a `Promise` (including for `.then()` chains), synchronous throws from the platform surface as Promise rejections, and the platform's synchronous suspend semantics are preserved (the call site runs to completion before subsequent statements).

## 1.47.0

### Minor Changes

- [#1115](https://github.com/tailor-platform/sdk/pull/1115) [`8dd619e`](https://github.com/tailor-platform/sdk/commit/8dd619e9c58f4662b117bbd968ecf9528d688fe4) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `@tailor-platform/sdk/vitest` (beta) — a Vitest plugin and environment that emulates the Tailor Platform function runtime locally. Catches `node:*` imports and Node.js globals usage that would fail at deploy time, and provides mock control objects (`tailordbMock`, `workflowMock`, `secretmanagerMock`, `authconnectionMock`, `idpMock`, `fileMock`, `iconvMock`) for all platform APIs with response configuration and call recording.

  Revamp `packages/sdk/docs/testing.md` into a 2-layer model (Unit Tests / E2E Tests). The previous structure split Unit, Bundled, and Workflow tests across overlapping sections and contained broken vitest imports and references to a non-existent `--template testing`. The new docs cover testing resolvers (simple, with TailorDB mocks, with DI, and with wait points) and workflow jobs (simple, with `triggerJobFunction` mocks, with wait-point mocks, and full-workflow integration), all anchored on the actual `resolver` and `workflow` templates.

  Mark `createImportMain` and `setupInvokerMock` from `@tailor-platform/sdk/test` as `@deprecated`. `createImportMain` is an SDK-internal helper for verifying bundled output; applications should test their TypeScript source directly (unit) and verify deployed behavior via E2E. `setupInvokerMock` is superseded by the `tailor-runtime` Vitest environment, where bundled tests can drive the invoker via `vi.spyOn(globalThis.tailor.context, "getInvoker").mockReturnValue(...)` and unit tests can pass `invoker` directly to `.body()`. Both exports remain in place for now to avoid a breaking change and will be removed in a future release.

  Remove the broken `tests/bundled.test.ts` from the `resolver` and `workflow` templates along with the related `bundled` vitest project and `test:bundled` / `test:bundled:prepare` scripts. These tests were not exercised by CI and had drifted out of sync with the SDK, producing failures on a fresh scaffold.

  Fix a broken anchor in `docs/services/workflow.md` that pointed at the removed `#testing-wait-points` heading; it now links to `../testing.md#jobs-that-wait-on-approval` to match the new testing docs structure.

### Patch Changes

- [#1155](https://github.com/tailor-platform/sdk/pull/1155) [`fd70f8c`](https://github.com/tailor-platform/sdk/commit/fd70f8c75aa9a315eaf23ee25f36f43324b2eb54) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix false-positive remote schema drift on `decimal` fields without an explicit
  `scale`. The platform stores decimal fields with a default scale of 6, but the
  snapshot generated by `tailor-sdk tailordb migration generate --init` did not
  record this default, so `tailor-sdk deploy` (formerly `apply`) reported drift as
  `scale: remote=6, expected=undefined` and blocked the deploy.

  Migration drift detection now treats an unset `scale` on a `decimal` field as
  equivalent to the platform default (6). No regeneration of existing snapshots
  is required; users no longer need `--no-schema-check` to work around this case.

- [#1164](https://github.com/tailor-platform/sdk/pull/1164) [`b1e8f5a`](https://github.com/tailor-platform/sdk/commit/b1e8f5a7e971527ff04cdb5867cacda2415e01bf) Thanks [@toiroakr](https://github.com/toiroakr)! - Eliminate the parser-layer exception that allowed `parser/service/tailordb/runtime.ts` to re-export runtime helpers from the configure module. Plugin attachment processing for a TailorDB type now lives in `PluginManager.processAttachmentsForType` and returns plain data (extended type, generated types, render events), so the cli layer applies state and renders progress without depending on `TailorAnyDBType`. Internal refactor with no public API change.

- [#1134](https://github.com/tailor-platform/sdk/pull/1134) [`02e12f6`](https://github.com/tailor-platform/sdk/commit/02e12f6b4a0a5986bc925defcac44717ae293c88) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @opentelemetry

- [#1135](https://github.com/tailor-platform/sdk/pull/1135) [`8f53196`](https://github.com/tailor-platform/sdk/commit/8f53196bd66e4ecba702074399979d577e289a07) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @clack/prompts to v1.3.0

- [#1137](https://github.com/tailor-platform/sdk/pull/1137) [`aef3653`](https://github.com/tailor-platform/sdk/commit/aef365380900c65420237cb47f75ff56f31c939a) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @napi-rs/keyring to v1.3.0

- [#1047](https://github.com/tailor-platform/sdk/pull/1047) [`aa6ec4a`](https://github.com/tailor-platform/sdk/commit/aa6ec4a562b771526ffb553aa03f7061ed483504) Thanks [@toiroakr](https://github.com/toiroakr)! - chore(setup github): bump bundled `tailor-platform/actions` ref to v1.1.0 and let Renovate keep it up to date going forward.

## 1.46.0

### Minor Changes

- [#1144](https://github.com/tailor-platform/sdk/pull/1144) [`ade6a39`](https://github.com/tailor-platform/sdk/commit/ade6a39dd46a5c48ca274718203628a30f0ba843) Thanks [@dqn](https://github.com/dqn)! - Rename the `apply` CLI command to `deploy`. `tailor-sdk deploy` is the canonical
  command name; `tailor-sdk apply` continues to work as an alias for backward
  compatibility on the command line.

  The programmatic API exported from `@tailor-platform/sdk/cli` is also available
  under the new name. `deploy` / `DeployOptions` are now the canonical exports,
  while `apply` / `ApplyOptions` continue to be re-exported as aliases so existing
  imports keep working:

  - `import { apply } from "@tailor-platform/sdk/cli"` — still works (alias for `deploy`)
  - `import type { ApplyOptions } from "@tailor-platform/sdk/cli"` — still works (alias for `DeployOptions`)

  Migration is optional but recommended:

  - `apply` → `deploy`
  - `ApplyOptions` → `DeployOptions`

- [#1145](https://github.com/tailor-platform/sdk/pull/1145) [`847284a`](https://github.com/tailor-platform/sdk/commit/847284ab50313bfffed03905173b3d868f7e7fce) Thanks [@dqn](https://github.com/dqn)! - Apply consistent CLI naming conventions:

  - Rename the `crash-report` subcommand to `crashreport` to match the single-word convention used by other multi-word commands (`authconnection`, `staticwebsite`). The legacy `crash-report` name is preserved as a native alias and still works.
  - Rename the positional arguments `executionId`, `executorName`, and `jobId` to their kebab-case form (`execution-id`, `executor-name`, `job-id`) on `function logs`, `workflow resume`, `workflow executions`, `executor jobs`, and `executor trigger`. Help output and generated docs now show the kebab-case form. Existing positional invocations are unaffected because positional arguments are referenced by position, not by name.

### Patch Changes

- [#1146](https://github.com/tailor-platform/sdk/pull/1146) [`a49a6ef`](https://github.com/tailor-platform/sdk/commit/a49a6efd62d0d374b3b73cf80bab897f8bcaa5d4) Thanks [@dqn](https://github.com/dqn)! - Stack traces shown by `tailor-sdk function logs <id>` now map back to original sources even after the deployed function has been updated. The `FunctionExecution.contentHash` reported by the server is used to download the exact bundle that ran, so source locations stay accurate across redeploys. Older servers that do not report `contentHash` keep using the existing `updatedAt` staleness fallback.

## 1.45.2

### Patch Changes

- [#1108](https://github.com/tailor-platform/sdk/pull/1108) [`430cba0`](https://github.com/tailor-platform/sdk/commit/430cba050400af0ef673035791fe4132b5323b90) Thanks [@toiroakr](https://github.com/toiroakr)! - Document how to use the re-exported Kysely `sql` tag from `@tailor-platform/sdk/kysely` to write raw SQL queries against the Kysely instance returned by `getDB()`. This was already supported; only documentation is added.

- [#1133](https://github.com/tailor-platform/sdk/pull/1133) [`3457fe7`](https://github.com/tailor-platform/sdk/commit/3457fe77efa90b5443b51c0cbb2fb6d1942b346f) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `workflow executions --wait`, `workflow start --wait`, and `executor jobs --wait` not responding to Ctrl+C in some terminals.

- [#1124](https://github.com/tailor-platform/sdk/pull/1124) [`82152a9`](https://github.com/tailor-platform/sdk/commit/82152a96753c8719472387e6d79f8454211074c7) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency es-toolkit to v1.46.1

- [#1125](https://github.com/tailor-platform/sdk/pull/1125) [`15a0023`](https://github.com/tailor-platform/sdk/commit/15a0023018ca67d53220e82281d51d633b16b0d5) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.28.17

- [#1127](https://github.com/tailor-platform/sdk/pull/1127) [`79050d4`](https://github.com/tailor-platform/sdk/commit/79050d4606dc695522f2eaa65a0079b20c3d51c8) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency pkg-types to v2.3.1

- [#1128](https://github.com/tailor-platform/sdk/pull/1128) [`5596283`](https://github.com/tailor-platform/sdk/commit/5596283bd09cddee10488606122ddebe57c58a75) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.18

## 1.45.1

### Patch Changes

- [#1110](https://github.com/tailor-platform/sdk/pull/1110) [`ba93ca3`](https://github.com/tailor-platform/sdk/commit/ba93ca3543c2927857dc79616ec680ed2b008ad1) Thanks [@toiroakr](https://github.com/toiroakr)! - Drop the `multiline-ts` dependency in favour of an in-tree implementation. The upstream package ships a `preinstall: npx only-allow pnpm` hook that, when a fresh copy is resolved (e.g. `npx create-tailor-sdk@latest`), causes npm's exec lock to time out with `ECOMPROMISED`. Replacing the dependency removes that failure path. Also drops `multiline-ts` from the `pnpm-workspace.yaml` `allowBuilds` list emitted by `create-tailor-sdk`.

- [#1109](https://github.com/tailor-platform/sdk/pull/1109) [`9965ba5`](https://github.com/tailor-platform/sdk/commit/9965ba5f3aefee43119d979fb827fef0160d618a) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix workflow job bundling to also transform `workflow.trigger()` and `job.trigger()` calls in `.mts`, `.cts`, `.mjs`, and `.cjs` files. Previously the rolldown transform plugin only matched `.ts` and `.js`, so trigger calls in non-default extensions were silently left as raw method calls and failed at runtime. The default-import resolver also strips trailing extensions so `import wf from "./simple.mjs"` resolves to the same workflow as `import wf from "./simple"`.

## 1.45.0

### Minor Changes

- [#1080](https://github.com/tailor-platform/sdk/pull/1080) [`52823be`](https://github.com/tailor-platform/sdk/commit/52823be3ab8ac4efd3b9621db60d3a6fb9033d12) Thanks [@toiroakr](https://github.com/toiroakr)! - Add an `idp` option to IdP user triggers (`idpUserCreatedTrigger`, `idpUserUpdatedTrigger`, `idpUserDeletedTrigger`, `idpUserTrigger`) so executors can subscribe to a specific IdP namespace. Previously, projects with multiple IdPs failed `apply` because the SDK could not decide which IdP an executor targeted; specify `idp: "my-idp"` to disambiguate, or omit it when the project defines a single IdP. The auto-configuration of `publishUserEvents` now applies only to IdPs that are actually targeted, and `publishUserEvents: false` on a targeted IdP is rejected with a clear error instead of a warning. The new `IdpName` type is narrowed to defined IdP names via the generated `tailor.d.ts` for compile-time validation.

### Patch Changes

- [#1094](https://github.com/tailor-platform/sdk/pull/1094) [`a872d26`](https://github.com/tailor-platform/sdk/commit/a872d26feb81266b27d0415d36b412f12e81fb42) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency ora to v9.4.0

- [#1092](https://github.com/tailor-platform/sdk/pull/1092) [`0687372`](https://github.com/tailor-platform/sdk/commit/0687372075bb8694505b2f0d0199e732606fd758) Thanks [@toiroakr](https://github.com/toiroakr)! - Restructure TailorDB migration documentation. The migration concepts, configuration, supported schema changes, automatic execution flow, and troubleshooting have moved from the CLI reference (`docs/cli/tailordb.md`) into a dedicated guide (`docs/services/tailordb-migration.md`). The CLI reference now keeps only the command tables and links to the guide. The guide also adds previously missing operational guidance: exact `migration set` semantics (label-only, not a DB rollback), team workflow and CI/CD coordination, failure recovery, machine user permissions, multi-namespace ordering, performance for large tables, local testing, rollback strategy, observability, and a beta notice. Minor wording corrections for the pre-migration phase and foreign key change classification.

## 1.44.2

### Patch Changes

- [#1096](https://github.com/tailor-platform/sdk/pull/1096) [`53dbbaf`](https://github.com/tailor-platform/sdk/commit/53dbbaf4a6de353f227c3ef57f39580b7e1d9379) Thanks [@k1LoW](https://github.com/k1LoW)! - Fix workflow bundle build failure caused by removing default exports from dependency files during cross-file workflow imports

## 1.44.1

### Patch Changes

- [#1088](https://github.com/tailor-platform/sdk/pull/1088) [`6dc5318`](https://github.com/tailor-platform/sdk/commit/6dc53185418c117c65cebd92c8ee38ae406e8c9a) Thanks [@k1LoW](https://github.com/k1LoW)! - Fix workflow bundle build failure caused by dead default imports after cross-file trigger transformation

- [#1085](https://github.com/tailor-platform/sdk/pull/1085) [`0947e14`](https://github.com/tailor-platform/sdk/commit/0947e14daf39bf35b84f496984c32acb4c7bc24b) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `concurrencyPolicy` option to `createWorkflow` for limiting concurrent workflow executions

## 1.44.0

### Minor Changes

- [#1064](https://github.com/tailor-platform/sdk/pull/1064) [`683478e`](https://github.com/tailor-platform/sdk/commit/683478e13b3e308739da5578ad5e13602087700e) Thanks [@dqn](https://github.com/dqn)! - `tailor-sdk api` discoverability improvements:

  - New `tailor-sdk api list` subcommand enumerates all invocable `OperatorService` methods. Streaming RPCs are excluded since the command only handles unary requests.
  - New `tailor-sdk api inspect <endpoint>` subcommand prints the input message tree of an endpoint without sending a request, including `oneof` membership, recursive type tagging, and `map` value schemas. Combine with the global `--json` flag for machine-readable output.
  - Shell completion now suggests `OperatorService` method names for the `endpoint` positional of `tailor-sdk api` and `tailor-sdk api inspect`.

- [#1039](https://github.com/tailor-platform/sdk/pull/1039) [`852968d`](https://github.com/tailor-platform/sdk/commit/852968d2e25a3deeb5169132fb76db0d93631c34) Thanks [@dqn](https://github.com/dqn)! - Wire `--order` / `--limit` through the remaining list commands that were missed in the previous pass: `workspace list`, `workspace user list`, `workspace app list`, `organization folder list`, `executor webhook list`, and `crash-report list`. Existing behavior is preserved when the flags are omitted (server-default order, unlimited), so scripts already invoking these commands are unaffected. The programmatic helpers (`listWorkspaces`, `listUsers`, `listApps`, `listFolders`, `listWebhookExecutors`) accept a new optional `order` field with the same defaults.

### Patch Changes

- [#1079](https://github.com/tailor-platform/sdk/pull/1079) [`8ab2714`](https://github.com/tailor-platform/sdk/commit/8ab271494cf76ee8f588848887fa8e9d3eb91bfa) Thanks [@dqn](https://github.com/dqn)! - Suppress the spurious `Static website "<name>" not found for CORS configuration` warning during `apply` planning on the first deployment. The warning previously fired whenever `plan` looked up a static website that the same apply run was about to create. Locally-defined static websites referenced via `:url` patterns in `cors` or OAuth2 `redirectURIs` are now treated as expected during planning; missing remote websites still warn when they are not part of the local configuration.

- [#1074](https://github.com/tailor-platform/sdk/pull/1074) [`d272f26`](https://github.com/tailor-platform/sdk/commit/d272f2604f31f2b61d880f1e57d2732b18f5c982) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.4.15

- [#1076](https://github.com/tailor-platform/sdk/pull/1076) [`4d8c7a3`](https://github.com/tailor-platform/sdk/commit/4d8c7a39adadb09a991f93f44ed519efc506762f) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update rolldown

- [#1082](https://github.com/tailor-platform/sdk/pull/1082) [`15b791d`](https://github.com/tailor-platform/sdk/commit/15b791d4c2d38e8f30e09d739b947099bfece8bd) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @bufbuild/protobuf to v2.12.0

- [#1083](https://github.com/tailor-platform/sdk/pull/1083) [`16d8a42`](https://github.com/tailor-platform/sdk/commit/16d8a427336378a784c0bb492a858206535ff68e) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency es-toolkit to v1.46.0

## 1.43.0

### Minor Changes

- [#1062](https://github.com/tailor-platform/sdk/pull/1062) [`7c39665`](https://github.com/tailor-platform/sdk/commit/7c39665bc3364d3bc644c5277f3f9f51926fc2b2) Thanks [@dqn](https://github.com/dqn)! - Auto-enable `publishUserEvents` on IdP services when the project defines executors with `idpUser` triggers (`idpUserCreatedTrigger`, `idpUserUpdatedTrigger`, `idpUserDeletedTrigger`, or `idpUserTrigger`). Previously, omitting `publishUserEvents` defaulted to `false`, silently preventing those executors from firing. The SDK now auto-configures `publishUserEvents: true` for every IdP in the project when any executor uses an `idpUser` trigger, and warns if an IdP explicitly sets `publishUserEvents: false` while such executors are present. Set `publishUserEvents: false` explicitly to opt out.

### Patch Changes

- [#1060](https://github.com/tailor-platform/sdk/pull/1060) [`4ffec9f`](https://github.com/tailor-platform/sdk/commit/4ffec9f86766dc1199ccef31223697c786c3f388) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxc

## 1.42.0

### Minor Changes

- [#1046](https://github.com/tailor-platform/sdk/pull/1046) [`9f99c0d`](https://github.com/tailor-platform/sdk/commit/9f99c0d284a5f227acafbb41db6db0bf7293c496) Thanks [@remiposo](https://github.com/remiposo)! - Expose `invoker` on resolver/executor/workflow body contexts. The SDK now calls `tailor.context.getInvoker()` inside bundled wrappers and passes the result to user code as `context.invoker` / `args.invoker`. This reflects `authInvoker` delegation (machine user when specified) and is `null` for anonymous callers.

## 1.41.0

### Minor Changes

- [#514](https://github.com/tailor-platform/sdk/pull/514) [`3047d45`](https://github.com/tailor-platform/sdk/commit/3047d45fd8daa38616ecaad20d5c04cf75d23931) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Add `function get` and `function list` CLI commands for querying function registries in a workspace

- [#987](https://github.com/tailor-platform/sdk/pull/987) [`35b2090`](https://github.com/tailor-platform/sdk/commit/35b2090b0009d26ebcbb69c76540791b2f39924e) Thanks [@toiroakr](https://github.com/toiroakr)! - Add wait/resolve support for human-in-the-loop workflows via `defineWaitPoint()` and `defineWaitPoints()` with typed `.wait()` and `.resolve()` methods.

  Tighten `createWorkflowJob` I/O types: both `Input` and `Output` must now be JsonValue-compatible (plain objects/arrays; no class instances or functions). `Output` previously accepted `Jsonifiable` with a `Jsonify<Output>` return transform on `.trigger()`, but the platform runtime rejects non-plain objects, so the old types did not match actual runtime behavior.

  Reject top-level `null` in `createWorkflowJob` `Input` and in wait-point `Payload`: the platform normalizes top-level `null`/`undefined` args to `{}`, so declaring a top-level nullable type would cause the body/callback to receive `{}` at runtime, mismatching the declared type. Nested `null` inside objects or arrays is preserved by JSON serialization and remains allowed.

### Patch Changes

- [#1050](https://github.com/tailor-platform/sdk/pull/1050) [`9232660`](https://github.com/tailor-platform/sdk/commit/92326608640e473138712ac00adc29369980c604) Thanks [@toiroakr](https://github.com/toiroakr)! - Address Dependabot noise for the valibot ReDoS advisory (GHSA-vqpr-j7v3-hqw9): bump `@toiroakr/lines-db` to 0.9.2 and document the remaining transitive `@liam-hq/cli → valibot@1.1.0` report in the SDK README, including an override snippet for consumers who want to silence it.

- [#1030](https://github.com/tailor-platform/sdk/pull/1030) [`fc4cc7c`](https://github.com/tailor-platform/sdk/commit/fc4cc7cc4430c545c50eb8bb4b406023c91d8290) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.4.14

- [#1041](https://github.com/tailor-platform/sdk/pull/1041) [`0858d64`](https://github.com/tailor-platform/sdk/commit/0858d64b3a03a3a9d994ebe5cd18a803b9780cac) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm/action-setup action to v6.0.3

- [#1044](https://github.com/tailor-platform/sdk/pull/1044) [`04c1fea`](https://github.com/tailor-platform/sdk/commit/04c1fea62a0eb70c24609cdf9bccf0a012d71875) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency std-env to v4.1.0

- [#1045](https://github.com/tailor-platform/sdk/pull/1045) [`09fce15`](https://github.com/tailor-platform/sdk/commit/09fce1500cc24bcf6089248030168817598f47bd) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency type-fest to v5.6.0

- [#1051](https://github.com/tailor-platform/sdk/pull/1051) [`f7e1d34`](https://github.com/tailor-platform/sdk/commit/f7e1d340ecac5ea37c3c5ab33bd3d4a536274817) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer

- [#1052](https://github.com/tailor-platform/sdk/pull/1052) [`7e75310`](https://github.com/tailor-platform/sdk/commit/7e7531040b3ceac90e25f633d71f502ac1ac3239) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @toiroakr/read-multiline to v0.3.2

## 1.40.1

### Patch Changes

- [#1026](https://github.com/tailor-platform/sdk/pull/1026) [`7f89969`](https://github.com/tailor-platform/sdk/commit/7f899699ad0386dd0b89b5660d7f49efe07f8647) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `apply` plan for IdP services when `permission` is omitted. The platform returns an empty `IdPPermission` (all action arrays empty) for services without configured permission policies, while the SDK sent `undefined`. The diff logic now normalizes an all-empty permission message to `undefined` so repeated applies are idempotent instead of always reporting the service as updated.

- [#1025](https://github.com/tailor-platform/sdk/pull/1025) [`af5262a`](https://github.com/tailor-platform/sdk/commit/af5262a14a31aa721c5b41b26425d938abb6485e) Thanks [@k1LoW](https://github.com/k1LoW)! - Update IdP documentation to promote `permission`-based access control as the primary pattern over legacy `authorization`

- [#1029](https://github.com/tailor-platform/sdk/pull/1029) [`825bf86`](https://github.com/tailor-platform/sdk/commit/825bf86d5df0ab98665989bf7ff59d5db0597a94) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @toiroakr/read-multiline to v0.3.1

- [#1031](https://github.com/tailor-platform/sdk/pull/1031) [`2e5f589`](https://github.com/tailor-platform/sdk/commit/2e5f589e50937e091f244cd1632ee7252a560394) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update rolldown

- [#1038](https://github.com/tailor-platform/sdk/pull/1038) [`d29b58a`](https://github.com/tailor-platform/sdk/commit/d29b58a27082fb52559548365c6ff75ee1e79122) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @opentelemetry

## 1.40.0

### Minor Changes

- [#1012](https://github.com/tailor-platform/sdk/pull/1012) [`d5f1659`](https://github.com/tailor-platform/sdk/commit/d5f1659f3c53aa1b1839d9198bcd7e7071886daa) Thanks [@dqn](https://github.com/dqn)! - Add `tailor-sdk skills install` subcommand for installing the `tailor-sdk` agent skill from the locally installed SDK package, replacing the standalone `tailor-sdk-skills` binary that fetched `main` from GitHub. The skill version now always matches the installed SDK version, and files are copied (not symlinked) so they persist across `pnpm install`.

  The `tailor-sdk-skills` binary is kept as a deprecated shim that prints a runtime warning and delegates to `tailor-sdk skills install`. It will be removed in v2.

- [#1011](https://github.com/tailor-platform/sdk/pull/1011) [`6711bf8`](https://github.com/tailor-platform/sdk/commit/6711bf8cb2ce122594406d429c7b0b256a5dea1f) Thanks [@dqn](https://github.com/dqn)! - Add `--order` and `--limit` options to CLI list commands for consistent pagination. Time-series log commands (`function logs`, `workflow executions`, `executor jobs`) default to newest-first (`--order desc`) and the most recent 50 items (`--limit 50`); pass `--order asc` or `--limit 0` to opt out. Other list commands (`workflow list`, `executor list`, `staticwebsite list`, `oauth2client list`, `secret list`, `secret vault list`, `user pat list`, `machineuser list`, `authconnection list`) also default to `--order desc` and accept `--limit N` (unlimited when omitted or set to `0`); pass `--order asc` to restore ascending order.

- [#895](https://github.com/tailor-platform/sdk/pull/895) [`a4b134d`](https://github.com/tailor-platform/sdk/commit/a4b134d796a335941c83f49cb572f82ea3fc522a) Thanks [@dqn](https://github.com/dqn)! - Replace query REPL input with a multiline editor supporting inline editing, undo/redo, persistent history, syntax highlighting (SQL and GraphQL), and auto-closing brackets with auto-indent. The submit/newline key binding is configurable via `--newline-on-enter` / `--no-newline-on-enter`, or the `TAILOR_PLATFORM_QUERY_NEWLINE_ON_ENTER` environment variable (default: newline on Enter, submit on Shift+Enter). Persistent history is now scoped per profile and workspace ID so statements from one environment are not replayed against another; the previous single shared history file is no longer read.

### Patch Changes

- [#1024](https://github.com/tailor-platform/sdk/pull/1024) [`98cf36f`](https://github.com/tailor-platform/sdk/commit/98cf36f45df1b4d7f01f8e4bdfa13d7b798e3068) Thanks [@haru0017](https://github.com/haru0017)! - Fix `executor webhook list` to return correct webhook URLs

- [#996](https://github.com/tailor-platform/sdk/pull/996) [`cbb0638`](https://github.com/tailor-platform/sdk/commit/cbb06385578fd37427d73e1602358344a63646f9) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix broken link to `example/resolvers/triggerWorkflow.ts` in the workflow service docs. The link used a relative path that escaped the `docs/` directory and 404'd on https://docs.tailor.tech; it now points to the GitHub source URL so it resolves on both the docs site and GitHub.

- [#1007](https://github.com/tailor-platform/sdk/pull/1007) [`d74dc27`](https://github.com/tailor-platform/sdk/commit/d74dc2741c048cb94c00d8bd4125cb64b6468dea) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxc

- [#1015](https://github.com/tailor-platform/sdk/pull/1015) [`a2bace2`](https://github.com/tailor-platform/sdk/commit/a2bace2537cbcf2ff826f184ea48db6eb9d7b67d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.101

- [#1016](https://github.com/tailor-platform/sdk/pull/1016) [`c480bcb`](https://github.com/tailor-platform/sdk/commit/c480bcb895a5d28bc72c41eebd0937f75e47f154) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.68.2

## 1.39.1

### Patch Changes

- [#885](https://github.com/tailor-platform/sdk/pull/885) [`c67000f`](https://github.com/tailor-platform/sdk/commit/c67000fae7fcfe394e27bae8e12431fac2dc47d0) Thanks [@toiroakr](https://github.com/toiroakr)! - Auto-inject workspaceId and namespaceName into `api` command request body based on proto schema introspection and SDK config

- [#1017](https://github.com/tailor-platform/sdk/pull/1017) [`ab445c4`](https://github.com/tailor-platform/sdk/commit/ab445c494acc3ec1b1f7f135d97f06126902043a) Thanks [@k1LoW](https://github.com/k1LoW)! - Make `authorization` field optional in `defineIdp()` for migration to permission-based access control

- [#930](https://github.com/tailor-platform/sdk/pull/930) [`3bfeec3`](https://github.com/tailor-platform/sdk/commit/3bfeec37db1f28071ac0eeb201f9eea14f0f0d8e) Thanks [@toiroakr](https://github.com/toiroakr)! - Internal refactoring of type layer boundaries. No changes to public API.

- [#1014](https://github.com/tailor-platform/sdk/pull/1014) [`faa3301`](https://github.com/tailor-platform/sdk/commit/faa3301b7ff341ff3ddb52d387ae466381d267e2) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): lock file maintenance

## 1.39.0

### Minor Changes

- [#1000](https://github.com/tailor-platform/sdk/pull/1000) [`fbfb157`](https://github.com/tailor-platform/sdk/commit/fbfb15780f8c61aeb30994b2e3d675c40ac32baa) Thanks [@toiroakr](https://github.com/toiroakr)! - Support `TAILOR_PLATFORM_SDK_DTS_PATH` environment variable to customize the output path of `tailor.d.ts`

### Patch Changes

- [#1002](https://github.com/tailor-platform/sdk/pull/1002) [`e0f6384`](https://github.com/tailor-platform/sdk/commit/e0f6384cad3ea1391119b104f159db8fb43205c8) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.99

## 1.38.0

### Minor Changes

- [#941](https://github.com/tailor-platform/sdk/pull/941) [`0a1b538`](https://github.com/tailor-platform/sdk/commit/0a1b53886ac738347e0e7fcb4f94e4c713fad316) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `upgrade` command with codemod.com-based architecture for automated SDK version migrations. Codemod execution is handled by the new `@tailor-platform/sdk-codemod` package.

- [#986](https://github.com/tailor-platform/sdk/pull/986) [`7de5d91`](https://github.com/tailor-platform/sdk/commit/7de5d91703f7bdd56bf433f60123da7322a6e361) Thanks [@toiroakr](https://github.com/toiroakr)! - Unify machine-user CLI flag naming and add `TAILOR_PLATFORM_MACHINE_USER_NAME` env variable

  - Add `--machine-user` flag to `query`, `workflow start`, and `login` to align with `function test-run` and the rest of the CLI's kebab-case convention. The previous `--machineuser` flag continues to work as a hidden alias.
  - Add `TAILOR_PLATFORM_MACHINE_USER_NAME` environment variable as a default machine user name for `query`, `workflow start`, and `function test-run`.

- [#990](https://github.com/tailor-platform/sdk/pull/990) [`6e9a062`](https://github.com/tailor-platform/sdk/commit/6e9a062b5ac6de3a7f0cd3e11a5d66d4ca85cd87) Thanks [@dqn](https://github.com/dqn)! - `tailor-sdk function logs <executionId>` now displays error details for failed executions. When `getFunctionExecution` returns a stack trace, the deployed script is downloaded automatically and frames are mapped back to the original source files via the inline sourcemap (with clickable file links and code snippets, matching the existing `function test-run` output). When the script cannot be downloaded, the stack trace is missing, or the function has been redeployed after the execution (detected by comparing the registry entry's `updatedAt` against the execution start time), the command falls back to a plain-text `Name: message` display with the raw stack trace to avoid showing misleading source locations.

- [#977](https://github.com/tailor-platform/sdk/pull/977) [`44a0781`](https://github.com/tailor-platform/sdk/commit/44a07817272eabe87f9a4f25400fec5231f59e58) Thanks [@haru0017](https://github.com/haru0017)! - Add response customization for incoming webhook trigger executor

### Patch Changes

- [#993](https://github.com/tailor-platform/sdk/pull/993) [`d978a9d`](https://github.com/tailor-platform/sdk/commit/d978a9d26534533bfca78e7c6415cab16279d977) Thanks [@toiroakr](https://github.com/toiroakr)! - Accept a wider range of boolean values for environment variables

  The following environment variables now accept common truthy/falsy spellings
  (case-insensitive): `true/false`, `1/0`, `yes/no`, `on/off`, `t/f`, `y/n`.

  - `TAILOR_ENABLE_INLINE_SOURCEMAP`
  - `TAILOR_PLATFORM_SDK_BUILD_ONLY`
  - `DEBUG`

  Previously only the literal string `"true"` enabled these flags.

- [#995](https://github.com/tailor-platform/sdk/pull/995) [`d6bc33c`](https://github.com/tailor-platform/sdk/commit/d6bc33c9b9aee0fdf9cb1edeea58b3cd0bb45f15) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `createTailorDBHook` to correctly handle `db.object({...}, { array: true })` fields. Previously, array values (and `null`/omitted values for optional array fields) were treated as a single nested object and processed recursively, corrupting the value and causing seed validation to fail with "Expected an array". Array elements are now recursed per element, and non-array values are passed through unchanged.

- [#963](https://github.com/tailor-platform/sdk/pull/963) [`0ed350f`](https://github.com/tailor-platform/sdk/commit/0ed350fa90c97634cf7d70ae055550bc021ed1b8) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update vitest to v4.1.4

- [#975](https://github.com/tailor-platform/sdk/pull/975) [`120ef30`](https://github.com/tailor-platform/sdk/commit/120ef304e6d4a0593745ad8a0e484aa2cc21202c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.97

- [#976](https://github.com/tailor-platform/sdk/pull/976) [`08897a3`](https://github.com/tailor-platform/sdk/commit/08897a32b90388ed1adcbc07395d445f22ab92ce) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.9.6

- [#979](https://github.com/tailor-platform/sdk/pull/979) [`1e0eb8c`](https://github.com/tailor-platform/sdk/commit/1e0eb8c1b5d25e51b3c846f54cf7133dbddd1509) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.28.16

- [#981](https://github.com/tailor-platform/sdk/pull/981) [`2cc18f5`](https://github.com/tailor-platform/sdk/commit/2cc18f5e3d30e25da02bce70d0263af3fa73df19) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.494.1

- [#982](https://github.com/tailor-platform/sdk/pull/982) [`8ad0591`](https://github.com/tailor-platform/sdk/commit/8ad0591f7934351b4559bced1f46a3dabdeffc48) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6.4.0

- [#983](https://github.com/tailor-platform/sdk/pull/983) [`b1cb7d3`](https://github.com/tailor-platform/sdk/commit/b1cb7d332ef471ea845011ea9d42819a3e426621) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm/action-setup action to v6

- [#988](https://github.com/tailor-platform/sdk/pull/988) [`484033d`](https://github.com/tailor-platform/sdk/commit/484033d4d17b8f76299102332a972816b8bed877) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency vitest to v4.1.4

- [#989](https://github.com/tailor-platform/sdk/pull/989) [`13be969`](https://github.com/tailor-platform/sdk/commit/13be969ad22d2609f974f866c98a23d6100c31fa) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.68.1

- [#992](https://github.com/tailor-platform/sdk/pull/992) [`f13ad71`](https://github.com/tailor-platform/sdk/commit/f13ad71475dc444aaf40dd56609c104aa1487677) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency globals to v17.5.0

- [#997](https://github.com/tailor-platform/sdk/pull/997) [`61d5c34`](https://github.com/tailor-platform/sdk/commit/61d5c3466962c270410df07fa6d614c36b2ced2e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update flatt-security/setup-takumi-guard-npm digest to 9a5d797

- [#999](https://github.com/tailor-platform/sdk/pull/999) [`4ad6aaf`](https://github.com/tailor-platform/sdk/commit/4ad6aaf4374ecb48f6509cd783cdf597b0a116ee) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.21.8

- [#994](https://github.com/tailor-platform/sdk/pull/994) [`3622294`](https://github.com/tailor-platform/sdk/commit/36222949efd98d8d5b8ae6d5482d2089d0e2a1f2) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailor-sdk function test-run` showing stack trace paths with a spurious `../` prefix (e.g. `../.tailor-sdk/test-run/test-run--add.entry.js`). Sourcemap `sources` are now emitted relative to the current working directory, and cwd-relative paths that start with a dotfile directory (e.g. `.tailor-sdk/...`) are explicitly prefixed with `./` in the display.

## 1.37.0

### Minor Changes

- [#971](https://github.com/tailor-platform/sdk/pull/971) [`be1a354`](https://github.com/tailor-platform/sdk/commit/be1a354c44f4c406d674fb03fc6695d07662dfac) Thanks [@toiroakr](https://github.com/toiroakr)! - Accept plain string for `authInvoker` in resolvers, executors, and `workflow.trigger()` (e.g. `authInvoker: "kiosk"`). Machine user names are type-narrowed via the generated `tailor.d.ts` (`MachineUserNameRegistry` interface). `auth.invoker(...)` is now deprecated in favor of the string form, which avoids pulling config-layer (Node-only) dependencies into runtime bundles.

- [#858](https://github.com/tailor-platform/sdk/pull/858) [`28872e5`](https://github.com/tailor-platform/sdk/commit/28872e538fec564cdbd675a6fa102820fe6ccf49) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Group related resource changes in apply dry-run output

  Consolidate function registry changes with their parent resources (workflow, resolver, executor, auth hook) in dry-run display. Group TailorDB type and gqlPermission changes by type name. Nest resources under their namespace for clearer hierarchy.

  Plan summary counts now reflect grouped display units to match the displayed rows.

### Patch Changes

- [#972](https://github.com/tailor-platform/sdk/pull/972) [`0a70288`](https://github.com/tailor-platform/sdk/commit/0a7028873f6e9d0c13fc8df3e203f9f8c3ff45d3) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `UNRESOLVED_IMPORT` warning during SDK builds by replacing the self-referential `@tailor-platform/sdk` dynamic import in `function test-run` detection with an alias-based dynamic import

- [#961](https://github.com/tailor-platform/sdk/pull/961) [`6638782`](https://github.com/tailor-platform/sdk/commit/663878239f573537965071e61c92c70be1c4bdda) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.58.1

- [#964](https://github.com/tailor-platform/sdk/pull/964) [`3472427`](https://github.com/tailor-platform/sdk/commit/34724277f12e463d6e60b1613b035aa27d3161e5) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @inquirer/prompts to v8.4.1

- [#967](https://github.com/tailor-platform/sdk/pull/967) [`bed9050`](https://github.com/tailor-platform/sdk/commit/bed9050172b74ad5a2200de55b80fbc397b6ef7a) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.15

- [#968](https://github.com/tailor-platform/sdk/pull/968) [`da649c6`](https://github.com/tailor-platform/sdk/commit/da649c69285c4b7b53c28b2ad2b3531b2a0686be) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/create-github-app-token action to v3.1.1

- [#969](https://github.com/tailor-platform/sdk/pull/969) [`133bc14`](https://github.com/tailor-platform/sdk/commit/133bc143b542fc82a462b844c0eca3888332ae24) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm/action-setup action to v6

## 1.36.0

### Minor Changes

- [#920](https://github.com/tailor-platform/sdk/pull/920) [`1b64d8e`](https://github.com/tailor-platform/sdk/commit/1b64d8e07c4b8b2c8bcfaded5210b8774d4556ff) Thanks [@dqn](https://github.com/dqn)! - Show original source locations and code snippets in `function test-run` errors using inline sourcemaps

- [#931](https://github.com/tailor-platform/sdk/pull/931) [`a1dab54`](https://github.com/tailor-platform/sdk/commit/a1dab54dfec4c7eb69348ab94a82de9d22231c45) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `ignoreNullishValues` option to `defineSecretManager` to skip secrets with nullish values during deploy

- [#965](https://github.com/tailor-platform/sdk/pull/965) [`c273be3`](https://github.com/tailor-platform/sdk/commit/c273be330071a9e3d2d2ebc65ef9b17e9c995ddc) Thanks [@haru0017](https://github.com/haru0017)! - Add `defaultRedirectURL` to SAML IdP config for handling SAML ACS responses with empty RelayState

### Patch Changes

- [#911](https://github.com/tailor-platform/sdk/pull/911) [`3cf9975`](https://github.com/tailor-platform/sdk/commit/3cf997591ac06c18a973cd16b3c6bc70b05f6793) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `permission` option to `defineIdp()` for per-operation permission policies on IdP users (create, read, update, delete, sendPasswordResetEmail)

- [#947](https://github.com/tailor-platform/sdk/pull/947) [`19f95c2`](https://github.com/tailor-platform/sdk/commit/19f95c27e22027037457fcfcd9adca360f62553d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint to v1.59.0

- [#956](https://github.com/tailor-platform/sdk/pull/956) [`391c53d`](https://github.com/tailor-platform/sdk/commit/391c53d32dd7108aead8917abb12a2b928df792a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): lock file maintenance

- [#957](https://github.com/tailor-platform/sdk/pull/957) [`cc14d77`](https://github.com/tailor-platform/sdk/commit/cc14d773c1f62b9e14c935cf4541983ed514fe90) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/upload-artifact action to v7.0.1

- [#958](https://github.com/tailor-platform/sdk/pull/958) [`32e6b1f`](https://github.com/tailor-platform/sdk/commit/32e6b1fa67a582db685f8268dbbb38c0ac45b101) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.93

- [#959](https://github.com/tailor-platform/sdk/pull/959) [`61b60c9`](https://github.com/tailor-platform/sdk/commit/61b60c9b0e8af467a50bc4ee06ada89fba76a653) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6.3.1

- [#960](https://github.com/tailor-platform/sdk/pull/960) [`9e0ce60`](https://github.com/tailor-platform/sdk/commit/9e0ce60b2d5c662c6983c60a377f5ce7c3dea7df) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.9.5

- [#962](https://github.com/tailor-platform/sdk/pull/962) [`dd74185`](https://github.com/tailor-platform/sdk/commit/dd74185d593be00122a173ca427c238292a627bf) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update marocchino/sticky-pull-request-comment action to v3.0.4

## 1.35.2

### Patch Changes

- [#925](https://github.com/tailor-platform/sdk/pull/925) [`ce5b766`](https://github.com/tailor-platform/sdk/commit/ce5b76662951cbe89779d45512a57c80cf4a2984) Thanks [@toiroakr](https://github.com/toiroakr)! - `function test-run` resolver arg no longer requires the `input` wrapper key — pass input fields directly (e.g. `-a '{"a":1}'`). The old `{"input":{...}}` format is detected via schema validation and emits a deprecation warning. When no input schema is defined, `--arg` is ignored with a warning.

- [#945](https://github.com/tailor-platform/sdk/pull/945) [`4d9892e`](https://github.com/tailor-platform/sdk/commit/4d9892e6e40c6eb4852714b8437339080e935189) Thanks [@anukiransolur](https://github.com/anukiransolur)! - chore(docs): added requirements for deterministic execution that the workflow must satisfy

- [#890](https://github.com/tailor-platform/sdk/pull/890) [`f0e03f2`](https://github.com/tailor-platform/sdk/commit/f0e03f267435094e88ec3cedd0af22bb4655264c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxfmt to v0.43.0

- [#927](https://github.com/tailor-platform/sdk/pull/927) [`dc699f3`](https://github.com/tailor-platform/sdk/commit/dc699f386b68d9647a77961f5ff34910f1b67939) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260406.1

- [#936](https://github.com/tailor-platform/sdk/pull/936) [`7a1f37b`](https://github.com/tailor-platform/sdk/commit/7a1f37bd376736a47f367ac06fdbb3fbb5fa1446) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency oxc-parser to v0.123.0

- [#943](https://github.com/tailor-platform/sdk/pull/943) [`14af922`](https://github.com/tailor-platform/sdk/commit/14af922e82d945c76b8c864d1bb177eb9fae26f6) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.92

- [#944](https://github.com/tailor-platform/sdk/pull/944) [`f0070a9`](https://github.com/tailor-platform/sdk/commit/f0070a9f41a15c9802b9c5caf201cf802e19a589) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @inquirer/core to v11.1.8

- [#946](https://github.com/tailor-platform/sdk/pull/946) [`c06dd0e`](https://github.com/tailor-platform/sdk/commit/c06dd0e16688b7863a4c85e569ed4e2e60bba971) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxfmt to v0.44.0

- [#948](https://github.com/tailor-platform/sdk/pull/948) [`d5f365f`](https://github.com/tailor-platform/sdk/commit/d5f365ff1153d34362b743d8d9019183f67b668a) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @inquirer/prompts to v8.4.0

- [#950](https://github.com/tailor-platform/sdk/pull/950) [`0dc96f9`](https://github.com/tailor-platform/sdk/commit/0dc96f9e2fde7088cef29142ce7917694dee5fca) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency oxc-parser to v0.124.0

## 1.35.1

### Patch Changes

- [#896](https://github.com/tailor-platform/sdk/pull/896) [`a57164c`](https://github.com/tailor-platform/sdk/commit/a57164cc7887d2f68600d6dfcb0c38c99dc534cb) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260403.1

- [#897](https://github.com/tailor-platform/sdk/pull/897) [`0846e5d`](https://github.com/tailor-platform/sdk/commit/0846e5d951ec0a30778376ad798ed970b80a1656) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.89

- [#898](https://github.com/tailor-platform/sdk/pull/898) [`58dc091`](https://github.com/tailor-platform/sdk/commit/58dc09166e37dd5a7b29fdb5c05a409e242f66dc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.9.3

- [#901](https://github.com/tailor-platform/sdk/pull/901) [`fe02730`](https://github.com/tailor-platform/sdk/commit/fe027300a149c924dc04281e076eaaf9e8f16145) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.28.15

- [#902](https://github.com/tailor-platform/sdk/pull/902) [`a6cd48e`](https://github.com/tailor-platform/sdk/commit/a6cd48e7789e36b9eca30879ec8da945f603bbf7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.58.0

- [#904](https://github.com/tailor-platform/sdk/pull/904) [`435b2e3`](https://github.com/tailor-platform/sdk/commit/435b2e31bb5cabe62878932c371623d2fa6284da) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @oxc-project/types to v0.123.0

- [#906](https://github.com/tailor-platform/sdk/pull/906) [`a81eea5`](https://github.com/tailor-platform/sdk/commit/a81eea534b756696fa3c33adc70c20fc5986af72) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6.3.0

- [#908](https://github.com/tailor-platform/sdk/pull/908) [`b3f2a03`](https://github.com/tailor-platform/sdk/commit/b3f2a03b4700e87c4ab1391b03ef2d824dc6072f) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update oxlint monorepo to v1.58.0

- [#910](https://github.com/tailor-platform/sdk/pull/910) [`cf80512`](https://github.com/tailor-platform/sdk/commit/cf805128342ae21b9eeff81704eac789876accd2) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @tailor-platform/function-types to v0.8.4

- [#915](https://github.com/tailor-platform/sdk/pull/915) [`ad28036`](https://github.com/tailor-platform/sdk/commit/ad2803663a5687c89237d831b28caf8d5fa18bb0) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @types/node to v24.12.2

- [#916](https://github.com/tailor-platform/sdk/pull/916) [`5b20cbd`](https://github.com/tailor-platform/sdk/commit/5b20cbd3749e180a00f70c251f37a2853cdd115b) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.13

- [#917](https://github.com/tailor-platform/sdk/pull/917) [`9a835e8`](https://github.com/tailor-platform/sdk/commit/9a835e801e7409acd2a2c1fbd14bc6553144c3eb) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.90

- [#918](https://github.com/tailor-platform/sdk/pull/918) [`a2b9002`](https://github.com/tailor-platform/sdk/commit/a2b9002a411c07af944bca1cafc8ba80fddc4e9b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.492.0

- [#921](https://github.com/tailor-platform/sdk/pull/921) [`6796c00`](https://github.com/tailor-platform/sdk/commit/6796c0040c1ea3f635a5473dceb4ce7e0cd2eaaa) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update flatt-security/setup-takumi-guard-npm digest to 3c4ad0e

- [#922](https://github.com/tailor-platform/sdk/pull/922) [`44644a9`](https://github.com/tailor-platform/sdk/commit/44644a9c75badb5b659f855900564bf0a202f51e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update marocchino/sticky-pull-request-comment action to v3.0.3

- [#923](https://github.com/tailor-platform/sdk/pull/923) [`b82bb95`](https://github.com/tailor-platform/sdk/commit/b82bb95779056de8dfa2ccc22da1ffac37e16b14) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint to v10.2.0

- [#924](https://github.com/tailor-platform/sdk/pull/924) [`cdd21da`](https://github.com/tailor-platform/sdk/commit/cdd21da0fabfb0cdabb22ba6ace696e1f2482915) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint-plugin-jsdoc to v62.9.0

- [#932](https://github.com/tailor-platform/sdk/pull/932) [`d50d40d`](https://github.com/tailor-platform/sdk/commit/d50d40dac22646232a8855119cb682ca83fd8603) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.9.4

- [#933](https://github.com/tailor-platform/sdk/pull/933) [`36e9c50`](https://github.com/tailor-platform/sdk/commit/36e9c50ecf3c916eb411f6919fbc7a0338d5c37a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint-tsgolint to v0.20.0

- [#935](https://github.com/tailor-platform/sdk/pull/935) [`3cd9fa0`](https://github.com/tailor-platform/sdk/commit/3cd9fa0870efed639f413a7d58ff26ddb11bd834) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @clack/prompts to v1.2.0

- [#937](https://github.com/tailor-platform/sdk/pull/937) [`1399b34`](https://github.com/tailor-platform/sdk/commit/1399b340640dc1a9e3f7033c6e01990e65372f8b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency lefthook to v2.1.5

## 1.35.0

### Minor Changes

- [#912](https://github.com/tailor-platform/sdk/pull/912) [`dbc22b9`](https://github.com/tailor-platform/sdk/commit/dbc22b9ab6c79c5f4342af5ad69224c3fab61922) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `ArrayColumnType<T>` for correct Kysely type resolution in ColumnType arrays

  Kysely's `Insertable`/`Selectable` only resolves `ColumnType` at the top-level table property, so `ColumnType[]` (e.g. `Timestamp[]`, `ObjectColumnType<{...}>[]`) was not resolved correctly. `ArrayColumnType<T>` wraps the array inside the `ColumnType` so that insert/select/update types are properly resolved for array fields containing `Timestamp` or `ObjectColumnType`.

## 1.34.0

### Minor Changes

- [#819](https://github.com/tailor-platform/sdk/pull/819) [`a63948d`](https://github.com/tailor-platform/sdk/commit/a63948de613f43eab7cc1208d23f92c1e15ae31b) Thanks [@toiroakr](https://github.com/toiroakr)! - Add auth connection support for managing OAuth2 connections with external providers

- [#855](https://github.com/tailor-platform/sdk/pull/855) [`150296e`](https://github.com/tailor-platform/sdk/commit/150296efbadcfa2dfe011c728c29dbbd63eb5634) Thanks [@dqn](https://github.com/dqn)! - Delegate deploy logic to a shared composite action (tailor-platform/actions/deploy) instead of generating local composite actions

## 1.33.2

### Patch Changes

- [#899](https://github.com/tailor-platform/sdk/pull/899) [`ce19ee7`](https://github.com/tailor-platform/sdk/commit/ce19ee7dbb5bbf45d13ad06b6a02ea770f17435b) Thanks [@remiposo](https://github.com/remiposo)! - Fix SQL query command rewriting user input, which broke INSERT/UPDATE statements and PascalCase table names

## 1.33.1

### Patch Changes

- [#838](https://github.com/tailor-platform/sdk/pull/838) [`36d437c`](https://github.com/tailor-platform/sdk/commit/36d437c54adb719aecb6a4d01a779bfd68d68adb) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix Kysely type generation for date/datetime fields inside nested objects (`db.object()`).

  - Added `ObjectColumnType<T>` helper type that wraps nested objects in `ColumnType`, enabling Kysely's `Insertable`/`Selectable` to correctly expand types for nested fields
  - Nested objects containing date/datetime fields now use `ObjectColumnType<{ field: Timestamp; ... }>`, so `Insertable` accepts `Date | string` and `Selectable` returns `Date`
  - Nullable fields inside nested objects are now optional (`?`) for inserts, required for selects

- [#891](https://github.com/tailor-platform/sdk/pull/891) [`ad5644a`](https://github.com/tailor-platform/sdk/commit/ad5644a61005a1484ce321cb4211d190d4ca9168) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `emailConfig` option to `defineIdp()` for namespace-level email defaults.

  - `fromName`: default sender display name for emails
  - `passwordResetSubject`: default subject for password reset emails
  - Validation: max 200 characters, no newline characters (header injection prevention)

- [#850](https://github.com/tailor-platform/sdk/pull/850) [`3ec5e35`](https://github.com/tailor-platform/sdk/commit/3ec5e3574043e062a69e4023579494e545c658eb) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @oxc-project/types to v0.122.0

- [#860](https://github.com/tailor-platform/sdk/pull/860) [`20ce9ac`](https://github.com/tailor-platform/sdk/commit/20ce9acfac1348b175ad694ea0f6693663abd196) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): lock file maintenance

- [#862](https://github.com/tailor-platform/sdk/pull/862) [`680be1b`](https://github.com/tailor-platform/sdk/commit/680be1b908ef6e50ddc0265cf31c47d1255bcd03) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.82

- [#863](https://github.com/tailor-platform/sdk/pull/863) [`fbd1220`](https://github.com/tailor-platform/sdk/commit/fbd1220eceaf773497c338a36d47432ec95e8adf) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint-plugin-jsdoc to v62.8.1

- [#865](https://github.com/tailor-platform/sdk/pull/865) [`d5ebb8b`](https://github.com/tailor-platform/sdk/commit/d5ebb8b533a1e4c259412ac46953ea0d08085236) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency graphql to v16.13.2

- [#866](https://github.com/tailor-platform/sdk/pull/866) [`e840eca`](https://github.com/tailor-platform/sdk/commit/e840eca55a832107af193f4b29bb7729097745f9) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint-tsgolint to v0.18.0

- [#867](https://github.com/tailor-platform/sdk/pull/867) [`2850dfb`](https://github.com/tailor-platform/sdk/commit/2850dfb935270b5d7c069526703d48bc0b61a221) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.21.6

- [#868](https://github.com/tailor-platform/sdk/pull/868) [`fcafc10`](https://github.com/tailor-platform/sdk/commit/fcafc103c4fb60abb4ad7990b6a8637b36ad6d1f) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update vitest monorepo to v4.1.2

- [#871](https://github.com/tailor-platform/sdk/pull/871) [`a1b8372`](https://github.com/tailor-platform/sdk/commit/a1b837274eb7c15cb246860a090a4d05229c1447) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update opentelemetry-js monorepo

- [#872](https://github.com/tailor-platform/sdk/pull/872) [`ea937d9`](https://github.com/tailor-platform/sdk/commit/ea937d957ff526aec1d441dad7b0af4fdf648378) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency rhysd/actionlint to v1.7.12

- [#873](https://github.com/tailor-platform/sdk/pull/873) [`5bee342`](https://github.com/tailor-platform/sdk/commit/5bee342221286580cb33468d825808542966206c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.83

- [#874](https://github.com/tailor-platform/sdk/pull/874) [`7ff3617`](https://github.com/tailor-platform/sdk/commit/7ff3617c0cd08518b5e1a2b254c87144ba304bed) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.21.7

- [#875](https://github.com/tailor-platform/sdk/pull/875) [`112769c`](https://github.com/tailor-platform/sdk/commit/112769c1a91247f8dc5e342eebac6ceb96a76e86) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.8.21

- [#876](https://github.com/tailor-platform/sdk/pull/876) [`0da01f9`](https://github.com/tailor-platform/sdk/commit/0da01f937072d375b363bbd021875d4fcefe41f7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.491.0

- [#877](https://github.com/tailor-platform/sdk/pull/877) [`3fb644d`](https://github.com/tailor-platform/sdk/commit/3fb644d7fddbb8373d88941f542dd1851b4272c5) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260329.1

- [#878](https://github.com/tailor-platform/sdk/pull/878) [`5f09037`](https://github.com/tailor-platform/sdk/commit/5f09037b9cfe8e5f8f3e5f9ebde2060b034a0d25) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-renovate-config to v2.12.0

- [#880](https://github.com/tailor-platform/sdk/pull/880) [`5a2ad18`](https://github.com/tailor-platform/sdk/commit/5a2ad18a6c47ba2128c5fe45db3b8cacb364da35) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6.1.0

- [#881](https://github.com/tailor-platform/sdk/pull/881) [`933249a`](https://github.com/tailor-platform/sdk/commit/933249ac9d393491c610516c96bc9d59691bf681) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update oxlint monorepo

- [#886](https://github.com/tailor-platform/sdk/pull/886) [`4d6a9d9`](https://github.com/tailor-platform/sdk/commit/4d6a9d95528dcdfeba131c2385fb5a5249f6c5db) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.85

- [#889](https://github.com/tailor-platform/sdk/pull/889) [`575fc11`](https://github.com/tailor-platform/sdk/commit/575fc11cc1d3bf5ab11bffe0c8079949c16cb90d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.67.0

- [#892](https://github.com/tailor-platform/sdk/pull/892) [`3ca56ef`](https://github.com/tailor-platform/sdk/commit/3ca56effb336c0232ae6701871e2d3c0f09ad7b6) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm to v10.33.0

## 1.33.0

### Minor Changes

- [#814](https://github.com/tailor-platform/sdk/pull/814) [`d5b2702`](https://github.com/tailor-platform/sdk/commit/d5b2702162a7344f1c53d373219d8482acac142d) Thanks [@toiroakr](https://github.com/toiroakr)! - Add multi-event executor trigger support with `recordTrigger`, `idpUserTrigger`, and `authAccessTokenTrigger` factory functions that accept an `events` array to handle multiple event types in a single executor. Args include `event` (short name) and `rawEvent` (full event type string) for runtime type narrowing.

- [#769](https://github.com/tailor-platform/sdk/pull/769) [`85e3053`](https://github.com/tailor-platform/sdk/commit/85e30538c981bd666680ce52cb2f986d94780593) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Improve apply planning by adding stable no-op detection and plan summaries.

  - Mark resources as `unchanged` when requested configuration already matches remote state, and keep update/create/delete behavior unchanged for drift, ownership mismatch, or missing resources.
  - Add a consolidated plan summary line (create/update/delete/replace/unchanged) to `apply` output and include unchanged counts in plan reporting.

### Patch Changes

- [#844](https://github.com/tailor-platform/sdk/pull/844) [`4f62742`](https://github.com/tailor-platform/sdk/commit/4f62742bea1d9de3e181af80a2fc14b78ac6ea21) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: add bidirectional foreign key between IDP user and userProfile type in seed schema

  When auth.userProfile is configured, the seed plugin now generates a foreign key from the userProfile type back to `_User`, ensuring seed data validation catches mismatches in both directions. Also bumps @toiroakr/lines-db to 0.9.1 which supports circular FK validation.

- [#857](https://github.com/tailor-platform/sdk/pull/857) [`8ed7e2a`](https://github.com/tailor-platform/sdk/commit/8ed7e2a2b23112c35f844f915f0f6eca6bef2c72) Thanks [@dqn](https://github.com/dqn)! - Add JSDoc documentation to previously undocumented public API exports for improved IDE intellisense.

- [#822](https://github.com/tailor-platform/sdk/pull/822) [`52f72bb`](https://github.com/tailor-platform/sdk/commit/52f72bb8a82f6e32889505d934ad0918391cd52e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint-tsgolint to v0.17.2

- [#833](https://github.com/tailor-platform/sdk/pull/833) [`dfc7216`](https://github.com/tailor-platform/sdk/commit/dfc7216a7e6d639610d9e68ae422b08f15857bb7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260325.1

- [#834](https://github.com/tailor-platform/sdk/pull/834) [`fecd40b`](https://github.com/tailor-platform/sdk/commit/fecd40bed724c39d5e4b12a219a3733693b06cd4) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6.0.3

- [#840](https://github.com/tailor-platform/sdk/pull/840) [`3dfb55f`](https://github.com/tailor-platform/sdk/commit/3dfb55f96aab68e355f10ccd993cc21141441724) Thanks [@renovate](https://github.com/apps/renovate)! - Update @clack/prompts to v1, adjusting validate callback signatures for the new API

- [#845](https://github.com/tailor-platform/sdk/pull/845) [`7976c0a`](https://github.com/tailor-platform/sdk/commit/7976c0a516cc09b3a4f1f183ab98360eefd449b2) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.81

- [#846](https://github.com/tailor-platform/sdk/pull/846) [`ab16815`](https://github.com/tailor-platform/sdk/commit/ab16815674196d50b1f14b37935e1c7ade255d14) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6.0.6

- [#847](https://github.com/tailor-platform/sdk/pull/847) [`9b60ae2`](https://github.com/tailor-platform/sdk/commit/9b60ae2a3b3ccc10839867ba7a49ef59e649287e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.57.2

- [#848](https://github.com/tailor-platform/sdk/pull/848) [`0c8aeac`](https://github.com/tailor-platform/sdk/commit/0c8aeac85680352e9e9f0c560e37c2e22b1ee1cc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update vitest monorepo to v4.1.1

- [#849](https://github.com/tailor-platform/sdk/pull/849) [`b1c9814`](https://github.com/tailor-platform/sdk/commit/b1c981432a4753d3868d482123931921a0e9bf74) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.12

## 1.32.1

### Patch Changes

- [#826](https://github.com/tailor-platform/sdk/pull/826) [`72c2842`](https://github.com/tailor-platform/sdk/commit/72c2842046b2841571e095e10187339fdf66acd5) Thanks [@toiroakr](https://github.com/toiroakr)! - Bundle `@tailor-platform/function-types` as a dependency of `@tailor-platform/sdk`. Users no longer need to install `@tailor-platform/function-types` separately or add it to their `tsconfig.json` types array. The ambient types are automatically available when importing from `@tailor-platform/sdk`.

- [#824](https://github.com/tailor-platform/sdk/pull/824) [`f4794c4`](https://github.com/tailor-platform/sdk/commit/f4794c4fed2cf1bec9e472d1ff29ca7748b78881) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency type-fest to v5.5.0

- [#825](https://github.com/tailor-platform/sdk/pull/825) [`9e0dc71`](https://github.com/tailor-platform/sdk/commit/9e0dc71bf094ea123f6484a31fb7929579896294) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxlint monorepo

- [#827](https://github.com/tailor-platform/sdk/pull/827) [`b13e31c`](https://github.com/tailor-platform/sdk/commit/b13e31c981fe368d1bec664c320a02c20e4eb083) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/create-github-app-token action to v3

- [#829](https://github.com/tailor-platform/sdk/pull/829) [`e0f68c0`](https://github.com/tailor-platform/sdk/commit/e0f68c054b248086060dd2e22ef8e6af10ef5e95) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dorny/paths-filter action to v4

- [#830](https://github.com/tailor-platform/sdk/pull/830) [`cb0c357`](https://github.com/tailor-platform/sdk/commit/cb0c357432bd121c7bb9ebbfc8f711a18b6a4f25) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update eslint monorepo to v10 (major)

- [#831](https://github.com/tailor-platform/sdk/pull/831) [`a567c70`](https://github.com/tailor-platform/sdk/commit/a567c70dc22661536e3a2314c6839899cb72a391) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.79

- [#836](https://github.com/tailor-platform/sdk/pull/836) [`77cdf5e`](https://github.com/tailor-platform/sdk/commit/77cdf5ed8de3cef96df7587c689c83a6b627381e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update github artifact actions (major)

- [#837](https://github.com/tailor-platform/sdk/pull/837) [`47b3e56`](https://github.com/tailor-platform/sdk/commit/47b3e56300c6df2c1eccbaafa4e320f13d176194) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm/action-setup action to v5

- [#841](https://github.com/tailor-platform/sdk/pull/841) [`c8a9ed6`](https://github.com/tailor-platform/sdk/commit/c8a9ed67bd102caacf155b8a107e468d007c81ab) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency std-env to v4

## 1.32.0

### Minor Changes

- [#805](https://github.com/tailor-platform/sdk/pull/805) [`d283a78`](https://github.com/tailor-platform/sdk/commit/d283a7802e2a0aaa6fc31c4ac2c7c3d4dc9654e6) Thanks [@toiroakr](https://github.com/toiroakr)! - Use TailorErrors for resolver input validation errors instead of generic Error, enabling the PF runtime to expand validation issues into individual GraphQL errors with field-level paths.

### Patch Changes

- [#813](https://github.com/tailor-platform/sdk/pull/813) [`34b525f`](https://github.com/tailor-platform/sdk/commit/34b525f69b1929394a2b246e4252308710032ee7) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @inquirer/core to v11.1.7

- [#828](https://github.com/tailor-platform/sdk/pull/828) [`d42bd97`](https://github.com/tailor-platform/sdk/commit/d42bd979085c800e3a46d73e76cc7c7e8251ecbb) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v6

## 1.31.0

### Minor Changes

- [#793](https://github.com/tailor-platform/sdk/pull/793) [`517ed78`](https://github.com/tailor-platform/sdk/commit/517ed782e1c4705b981822422cdd97541bddeeef) Thanks [@dqn](https://github.com/dqn)! - Add Bun runtime support for CLI and expand CI test matrix

  - Detect Bun/Deno runtimes and skip tsx registration for native TypeScript execution
  - Use dynamic import for connect-node transport to support Bun runtime
  - Expand CI smoke tests across OS, Node version, package manager, and runtime combinations

- [#746](https://github.com/tailor-platform/sdk/pull/746) [`b9113a0`](https://github.com/tailor-platform/sdk/commit/b9113a08698edcd03deae0bf7354701a59f4d76d) Thanks [@toiroakr](https://github.com/toiroakr)! - Add opt-in secure token storage via OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service). Set `TAILOR_USE_KEYRING=1` to enable. Default behavior remains unchanged (file-based V1 config) for backward compatibility with older SDK versions.

### Patch Changes

- [#806](https://github.com/tailor-platform/sdk/pull/806) [`cfe2c4b`](https://github.com/tailor-platform/sdk/commit/cfe2c4b194acf8bae674e8c1030a40cf2cb29ba9) Thanks [@toiroakr](https://github.com/toiroakr)! - Add documentation for `typeName` on enum/object fields and `pickFields`/`omitFields` on TailorDBType

- [#807](https://github.com/tailor-platform/sdk/pull/807) [`13ad5cd`](https://github.com/tailor-platform/sdk/commit/13ad5cd4027c4fc5925a8934050b68d1a51cb41c) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove unused `required` option from `FieldOptions` and dead `requiredExplicit` field from `FieldMetadata`

- [#744](https://github.com/tailor-platform/sdk/pull/744) [`5d2ab24`](https://github.com/tailor-platform/sdk/commit/5d2ab24393507b7333cfd3e4cdd2ec10e34abd44) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260320.1

- [#768](https://github.com/tailor-platform/sdk/pull/768) [`2d984a3`](https://github.com/tailor-platform/sdk/commit/2d984a3b798cd14bf9958eb89ad229a70b2c45c4) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @bufbuild/protobuf to v2.11.0

- [#774](https://github.com/tailor-platform/sdk/pull/774) [`a9160f4`](https://github.com/tailor-platform/sdk/commit/a9160f42dea8a8f62247e3bb4b2ffc307f50f33e) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @opentelemetry/exporter-trace-otlp-proto to v0.213.0

- [#777](https://github.com/tailor-platform/sdk/pull/777) [`cea90ef`](https://github.com/tailor-platform/sdk/commit/cea90ef1485fdcbc9e605cb34e48cdb55ef2a558) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency globals to v17.4.0

- [#783](https://github.com/tailor-platform/sdk/pull/783) [`858316f`](https://github.com/tailor-platform/sdk/commit/858316fa565031c77ea8e98890313c41d4c43d13) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency pkg-pr-new to v0.0.66

- [#785](https://github.com/tailor-platform/sdk/pull/785) [`8dcaac5`](https://github.com/tailor-platform/sdk/commit/8dcaac5420aec0cc7f193019cac80faaf0994c1b) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency ora to v9.3.0

- [#797](https://github.com/tailor-platform/sdk/pull/797) [`4863518`](https://github.com/tailor-platform/sdk/commit/4863518cb4b465aa8d8a794d3e333c8cf86da529) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.21.4

- [#798](https://github.com/tailor-platform/sdk/pull/798) [`e95f0a3`](https://github.com/tailor-platform/sdk/commit/e95f0a311732908191671942dab3ccd2be8319bb) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.57.1

- [#801](https://github.com/tailor-platform/sdk/pull/801) [`030539d`](https://github.com/tailor-platform/sdk/commit/030539d0f568c5b5c0a4c7acafe303ea2d5a56dd) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): lock file maintenance

- [#802](https://github.com/tailor-platform/sdk/pull/802) [`27f2908`](https://github.com/tailor-platform/sdk/commit/27f2908536a540e3707af983c7fef49cb4a4dcc8) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.77

- [#810](https://github.com/tailor-platform/sdk/pull/810) [`c16d87c`](https://github.com/tailor-platform/sdk/commit/c16d87cc7d9ef210230cb3e366bd6569e8f646a7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @tailor-platform/function-types to v0.8.3

- [#811](https://github.com/tailor-platform/sdk/pull/811) [`5fc6e4b`](https://github.com/tailor-platform/sdk/commit/5fc6e4b32736828cea7453d0cc2b66dec9808946) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.57.1

- [#812](https://github.com/tailor-platform/sdk/pull/812) [`1af673e`](https://github.com/tailor-platform/sdk/commit/1af673e978cd2642d6c9a8ef8c075dfc1098cb3c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.8.20

- [#815](https://github.com/tailor-platform/sdk/pull/815) [`d1b6d92`](https://github.com/tailor-platform/sdk/commit/d1b6d929f1317790b7fa4d7e2ea73580042c92f5) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency @inquirer/prompts to v8.3.2

- [#816](https://github.com/tailor-platform/sdk/pull/816) [`dc3fc6e`](https://github.com/tailor-platform/sdk/commit/dc3fc6e99b11252232c9960cca705cd213cec11b) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.10

- [#817](https://github.com/tailor-platform/sdk/pull/817) [`951ec13`](https://github.com/tailor-platform/sdk/commit/951ec13ea44ef3545a76e84e3e46779601ee5871) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.487.0

- [#818](https://github.com/tailor-platform/sdk/pull/818) [`25bbd17`](https://github.com/tailor-platform/sdk/commit/25bbd178609c7a102301c847c067483addcbf5df) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v5.88.1

## 1.30.0

### Minor Changes

- [#765](https://github.com/tailor-platform/sdk/pull/765) [`afe6f6f`](https://github.com/tailor-platform/sdk/commit/afe6f6fb968271d5bb7f2aff7317c089b9f7fd6e) Thanks [@toiroakr](https://github.com/toiroakr)! - Add organization and folder management CLI commands: `organization list/get/update/tree` and `organization folder list/get/create/update/delete` with programmatic API exports

### Patch Changes

- [#800](https://github.com/tailor-platform/sdk/pull/800) [`3c60fdf`](https://github.com/tailor-platform/sdk/commit/3c60fdf63212a307be3380b63a9fd29582419919) Thanks [@dqn](https://github.com/dqn)! - Use rolldown `write: false` to keep bundle output in memory, eliminating unnecessary disk I/O in all bundlers

- [#804](https://github.com/tailor-platform/sdk/pull/804) [`ee915c1`](https://github.com/tailor-platform/sdk/commit/ee915c121b25b7c14794fccb2fd6de79d0c3f604) Thanks [@toiroakr](https://github.com/toiroakr)! - Allow `as const` readonly arrays to be passed directly to `db.enum()` and `t.enum()` without requiring a spread workaround

## 1.29.0

### Minor Changes

- [#702](https://github.com/tailor-platform/sdk/pull/702) [`9b25f08`](https://github.com/tailor-platform/sdk/commit/9b25f084abfcb05262aece4f4624111c3d18ebdb) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `login --machineuser` flag for platform machine user authentication. Token is stored in platform config for automatic use by subsequent commands. Supports `--client-id` and `--client-secret` options with environment variable fallback (`TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID` / `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET`). Client secret is prompted securely when omitted.

### Patch Changes

- [#781](https://github.com/tailor-platform/sdk/pull/781) [`2de7b3e`](https://github.com/tailor-platform/sdk/commit/2de7b3ef369870a96c2d20696168f5267aa3de9b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.75

- [#786](https://github.com/tailor-platform/sdk/pull/786) [`38ef630`](https://github.com/tailor-platform/sdk/commit/38ef6309e257fc2fa0c831b2c3b9bff7dd797c74) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency p-limit to v7.3.0

- [#788](https://github.com/tailor-platform/sdk/pull/788) [`bbeaf1e`](https://github.com/tailor-platform/sdk/commit/bbeaf1e1ff4ed6838e1edf35e366f531aebb1c2b) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxlint monorepo

- [#796](https://github.com/tailor-platform/sdk/pull/796) [`17808f4`](https://github.com/tailor-platform/sdk/commit/17808f4b11fc59aa714eb92cea7955bc559b4178) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.28.14 [security]

- [#779](https://github.com/tailor-platform/sdk/pull/779) [`b234487`](https://github.com/tailor-platform/sdk/commit/b234487f5787f540035657d11aa2759847de4177) Thanks [@dragon3](https://github.com/dragon3)! - Use typed event configs for executor triggers instead of deprecated eventType/condition fields

## 1.28.0

### Minor Changes

- [#776](https://github.com/tailor-platform/sdk/pull/776) [`a2734bf`](https://github.com/tailor-platform/sdk/commit/a2734bfbfb71c06be324d162f2301f2930e3bfa6) Thanks [@toiroakr](https://github.com/toiroakr)! - Add managed vault guard to CLI secret commands and document runtime secret access via defineSecretManager

## 1.27.0

### Minor Changes

- [#674](https://github.com/tailor-platform/sdk/pull/674) [`1d50f25`](https://github.com/tailor-platform/sdk/commit/1d50f25aa6baca46fe886dca2c8eeade28f89186) Thanks [@dqn](https://github.com/dqn)! - Add crash reporting for automatic error capture

- [#787](https://github.com/tailor-platform/sdk/pull/787) [`10ade9a`](https://github.com/tailor-platform/sdk/commit/10ade9a4618aad4db4c63143e579de6216ddd07a) Thanks [@remiposo](https://github.com/remiposo)! - Add `authInvoker` option to `createResolver` for specifying a machine user to execute database operations and other platform actions. The `user` in the body function still reflects the original caller. Usage: `authInvoker: auth.invoker("machine-user-name")`

## 1.26.0

### Minor Changes

- [#778](https://github.com/tailor-platform/sdk/pull/778) [`392819d`](https://github.com/tailor-platform/sdk/commit/392819df890ce46f5884c438bdb7f3bce51bc9fd) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `hooks.beforeLogin` to `defineAuth` for running custom logic before user login (e.g. JIT provisioning)

- [#752](https://github.com/tailor-platform/sdk/pull/752) [`e4a965f`](https://github.com/tailor-platform/sdk/commit/e4a965f9934e495e190b00fa48f8fa50b479ec98) Thanks [@dqn](https://github.com/dqn)! - Add `tailor-sdk setup github` command for GitHub Actions workflow generation

### Patch Changes

- [#763](https://github.com/tailor-platform/sdk/pull/763) [`87e55af`](https://github.com/tailor-platform/sdk/commit/87e55af401b033fc3a403c15d5f1e7fce4a36b07) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint-plugin-jsdoc to v62.8.0

- [#764](https://github.com/tailor-platform/sdk/pull/764) [`563b358`](https://github.com/tailor-platform/sdk/commit/563b35801e728684e8cbe67d94b5e53558b49f1e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm/action-setup action to v4.4.0

- [#767](https://github.com/tailor-platform/sdk/pull/767) [`0eaa3f3`](https://github.com/tailor-platform/sdk/commit/0eaa3f32acc613ca112dcd5e2562ef43f41e8c8b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update vitest monorepo to v4.1.0

- [#771](https://github.com/tailor-platform/sdk/pull/771) [`31ac830`](https://github.com/tailor-platform/sdk/commit/31ac8305a90071ffba5150b0989c25adbeb55067) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.8.17

- [#773](https://github.com/tailor-platform/sdk/pull/773) [`6e2bc16`](https://github.com/tailor-platform/sdk/commit/6e2bc16fdf772d36cb231fc7baa874c018e10904) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.486.0

## 1.25.4

### Patch Changes

- [#775](https://github.com/tailor-platform/sdk/pull/775) [`a7a99da`](https://github.com/tailor-platform/sdk/commit/a7a99da4d7c1dfcb80db4de5d4fe7e5161c23e64) Thanks [@toiroakr](https://github.com/toiroakr)! - Skip postinstall type generation when no tailor.config.ts is found instead of creating an empty tailor.d.ts

- [#717](https://github.com/tailor-platform/sdk/pull/717) [`cabb93b`](https://github.com/tailor-platform/sdk/commit/cabb93b0b0837122f958be4fadda0da164c527f2) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @types/node to v24.12.0

- [#725](https://github.com/tailor-platform/sdk/pull/725) [`368a2fd`](https://github.com/tailor-platform/sdk/commit/368a2fdd2c1f28d12d5b010a1359322117e0c359) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v5.86.0

- [#732](https://github.com/tailor-platform/sdk/pull/732) [`0cb5d7f`](https://github.com/tailor-platform/sdk/commit/0cb5d7f296d30e14eeb55a60729583594fd138a4) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.485.0

- [#733](https://github.com/tailor-platform/sdk/pull/733) [`9543d3a`](https://github.com/tailor-platform/sdk/commit/9543d3a6c36396d6a29020edf15429fe1795bea3) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint-tsgolint to v0.16.0

- [#734](https://github.com/tailor-platform/sdk/pull/734) [`8460bdc`](https://github.com/tailor-platform/sdk/commit/8460bdc82a2da327a4436856b7a81be1636d1ff5) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency sonda to v0.11.1

- [#737](https://github.com/tailor-platform/sdk/pull/737) [`69fe62c`](https://github.com/tailor-platform/sdk/commit/69fe62c308c971256707953a12e972faf4220697) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.9

- [#738](https://github.com/tailor-platform/sdk/pull/738) [`7db1d9a`](https://github.com/tailor-platform/sdk/commit/7db1d9a646c6833a82191249f7d0c6cd5c2f066b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.8.15

- [#740](https://github.com/tailor-platform/sdk/pull/740) [`e9fc3f6`](https://github.com/tailor-platform/sdk/commit/e9fc3f6a2472c230cb8015c3adb45d691b795737) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.57.0

- [#747](https://github.com/tailor-platform/sdk/pull/747) [`72c14a7`](https://github.com/tailor-platform/sdk/commit/72c14a795dd60f28ebeae159f06908b88e9eed47) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.72

- [#754](https://github.com/tailor-platform/sdk/pull/754) [`cad764d`](https://github.com/tailor-platform/sdk/commit/cad764d28499466d4cd65786481eca6e0cebfe87) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/create-github-app-token action to v2.2.2

- [#756](https://github.com/tailor-platform/sdk/pull/756) [`1e972a4`](https://github.com/tailor-platform/sdk/commit/1e972a463be48c23ffabf71194f785face7e32f3) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency lefthook to v2.1.4

- [#757](https://github.com/tailor-platform/sdk/pull/757) [`1ceb017`](https://github.com/tailor-platform/sdk/commit/1ceb017f86196c66e19572fb43e12a1989e5f432) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.21.2

- [#758](https://github.com/tailor-platform/sdk/pull/758) [`73a5684`](https://github.com/tailor-platform/sdk/commit/73a5684f04467a3eacdedfeb35dd2a3c17690a31) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dorny/paths-filter action to v3.0.3

- [#759](https://github.com/tailor-platform/sdk/pull/759) [`4690057`](https://github.com/tailor-platform/sdk/commit/4690057b4798e728c6dff8851415c62c3c6b0fc7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm to v10.32.1

- [#770](https://github.com/tailor-platform/sdk/pull/770) [`6b93e7a`](https://github.com/tailor-platform/sdk/commit/6b93e7a5e673d8f2016f29f3fd4a1436d5ce119b) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix seed and query bundlers to use `@tailor-platform/sdk/kysely` re-export instead of importing `kysely` and `@tailor-platform/function-kysely-tailordb` directly, so they work without users installing these as direct dependencies

## 1.25.3

### Patch Changes

- [#749](https://github.com/tailor-platform/sdk/pull/749) [`5cf46ec`](https://github.com/tailor-platform/sdk/commit/5cf46ec88d7d7517300b916b02249d9ffaf8a083) Thanks [@toiroakr](https://github.com/toiroakr)! - Replace consola dependency with @inquirer/prompts for interactive prompts and direct stderr logging

## 1.25.2

### Patch Changes

- [#751](https://github.com/tailor-platform/sdk/pull/751) [`fd41720`](https://github.com/tailor-platform/sdk/commit/fd41720d8568e7082094e8f47f0cd7f77bb66e40) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix workflow executions list command failing with validation error when filtering by workflow name

- [#739](https://github.com/tailor-platform/sdk/pull/739) [`1342733`](https://github.com/tailor-platform/sdk/commit/1342733c952161025546e35f7a18ad1b5a7d492d) Thanks [@riku99](https://github.com/riku99)! - Insert rows one-by-one for tables with self-referencing foreign keys

- [#748](https://github.com/tailor-platform/sdk/pull/748) [`49d4db8`](https://github.com/tailor-platform/sdk/commit/49d4db84a987cc7b87367d8ee4725a2f52749a95) Thanks [@toiroakr](https://github.com/toiroakr)! - Use politty's `env` option for CLI argument environment variable fallback instead of manual `process.env` checks

- [#722](https://github.com/tailor-platform/sdk/pull/722) [`19504f0`](https://github.com/tailor-platform/sdk/commit/19504f00c271c9add68571499c11568dc31f38a7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint-plugin-jsdoc to v62.7.1

- [#723](https://github.com/tailor-platform/sdk/pull/723) [`b30f396`](https://github.com/tailor-platform/sdk/commit/b30f3960cc7447a3b6fab7100492ce56fae39317) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency graphql to v16.13.1

- [#724](https://github.com/tailor-platform/sdk/pull/724) [`d0b35d7`](https://github.com/tailor-platform/sdk/commit/d0b35d738539f3a1a89b0daf11429a5d86f4b6cc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260308.1

- [#729](https://github.com/tailor-platform/sdk/pull/729) [`80dddf2`](https://github.com/tailor-platform/sdk/commit/80dddf2c980c02e847615b5978bd9df1bbd88c84) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.57.0

- [#730](https://github.com/tailor-platform/sdk/pull/730) [`0088b14`](https://github.com/tailor-platform/sdk/commit/0088b14ee2331e341d8c9f867890683c81348539) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency lefthook to v2.1.3

- [#735](https://github.com/tailor-platform/sdk/pull/735) [`5ad8650`](https://github.com/tailor-platform/sdk/commit/5ad86506c873183d99a438790cbad4866fcd0ce1) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.21.1

- [#741](https://github.com/tailor-platform/sdk/pull/741) [`8a40799`](https://github.com/tailor-platform/sdk/commit/8a4079936cd68323bb5d354e7d39b0cf9d6c46c4) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm to v10.32.0

- [#719](https://github.com/tailor-platform/sdk/pull/719) [`60b882d`](https://github.com/tailor-platform/sdk/commit/60b882d631bd959f1b2e760430030edc68aa3dba) Thanks [@toiroakr](https://github.com/toiroakr)! - Upgrade politty to v0.4.9 and migrate to native globalArgs, cleanup, and arg effect patterns, eliminating the withCommonArgs wrapper

- [#736](https://github.com/tailor-platform/sdk/pull/736) [`db7399c`](https://github.com/tailor-platform/sdk/commit/db7399c9816f1f4b6a00f0ada0edd2cea23e26bd) Thanks [@remiposo](https://github.com/remiposo)! - Replace deprecated rolldown `inlineDynamicImports` option with `codeSplitting`

- [#726](https://github.com/tailor-platform/sdk/pull/726) [`75c3007`](https://github.com/tailor-platform/sdk/commit/75c30079a252618a812ae9ea96f97ae3c8fcbb9c) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `retryPolicy` option to `createWorkflow` for configuring workflow retry behavior with exponential backoff

## 1.25.1

### Patch Changes

- [#727](https://github.com/tailor-platform/sdk/pull/727) [`cf08b9b`](https://github.com/tailor-platform/sdk/commit/cf08b9be9af5027b4bfce6537ee182fb4d3586ab) Thanks [@dqn](https://github.com/dqn)! - fix: use kind-specific brand symbols to prevent cross-service false positives during generate

## 1.25.0

### Minor Changes

- [#670](https://github.com/tailor-platform/sdk/pull/670) [`0659515`](https://github.com/tailor-platform/sdk/commit/0659515f2aa2db5fa0e23c2cfe3e3af04dec2b3d) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `validate` subcommand to generated seed `exec.mjs` for validating JSONL data against schema definitions without deploying. Add `@tailor-platform/sdk/seed` export that provides `defineSchema` (re-exported from `@toiroakr/lines-db`) and `validateSeedData` wrapper to avoid phantom dependency issues.

### Patch Changes

- [#711](https://github.com/tailor-platform/sdk/pull/711) [`60d4803`](https://github.com/tailor-platform/sdk/commit/60d48038a5faa80846f8e7ce46a45fbe49e0cbdc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update changesets/action action to v1.7.0

- [#713](https://github.com/tailor-platform/sdk/pull/713) [`a20860d`](https://github.com/tailor-platform/sdk/commit/a20860d67cda7a16f009fc11e7f06e488b54189a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @changesets/changelog-github to v0.6.0

- [#715](https://github.com/tailor-platform/sdk/pull/715) [`1ae10fc`](https://github.com/tailor-platform/sdk/commit/1ae10fc99e953f3e44e23a7ad75d9c8c1fe6e8ed) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @changesets/cli to v2.30.0

- [#718](https://github.com/tailor-platform/sdk/pull/718) [`1f85c44`](https://github.com/tailor-platform/sdk/commit/1f85c44cb2bf20a932b4c002ffec9d8e83b696b5) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.481.0

- [#720](https://github.com/tailor-platform/sdk/pull/720) [`681daa4`](https://github.com/tailor-platform/sdk/commit/681daa473d7bce4cda8e12fa9525175c2d19e4ad) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-renovate-config to v2.11.0

- [#721](https://github.com/tailor-platform/sdk/pull/721) [`aa7d7ef`](https://github.com/tailor-platform/sdk/commit/aa7d7ef407cbe8d022f104589fc331db70788336) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.66.1

- [#652](https://github.com/tailor-platform/sdk/pull/652) [`988d5af`](https://github.com/tailor-platform/sdk/commit/988d5af6031d6a4373140590710186edef54529f) Thanks [@riku99](https://github.com/riku99)! - Add declarative secret management in tailor.config.ts via defineSecretManager() API

## 1.24.0

### Minor Changes

- [#701](https://github.com/tailor-platform/sdk/pull/701) [`3ea08c0`](https://github.com/tailor-platform/sdk/commit/3ea08c0e2c7ea49b43e67e6c83ac87d4b7e6be08) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Add `--file` input support to `tailor-sdk query`.

  This allows loading SQL or GraphQL queries from a file instead of passing the
  query text directly via `--query`.

- [#708](https://github.com/tailor-platform/sdk/pull/708) [`a67a1e4`](https://github.com/tailor-platform/sdk/commit/a67a1e4f49de8c550db69d744d305e6ab3aaece5) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Add `tailor-sdk query --edit` to open a temporary SQL or GraphQL file in your preferred editor before executing it, and honor `VISUAL` as well as `EDITOR` when choosing that editor.

### Patch Changes

- [#685](https://github.com/tailor-platform/sdk/pull/685) [`d00cea8`](https://github.com/tailor-platform/sdk/commit/d00cea879a094952b2d02fb3d844ef9157beccbe) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix CI race condition where concurrent PR runs delete each other's e2e workspaces by scoping cleanup to the current GitHub Actions run ID

- [#681](https://github.com/tailor-platform/sdk/pull/681) [`c333a70`](https://github.com/tailor-platform/sdk/commit/c333a700e1b409f0fd920c32fe2dd366b9e3df96) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): pin dependencies

- [#682](https://github.com/tailor-platform/sdk/pull/682) [`004cc5a`](https://github.com/tailor-platform/sdk/commit/004cc5a2db0b95049d5d3fff1f568018ff7ac268) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/checkout action to v6.0.2

- [#683](https://github.com/tailor-platform/sdk/pull/683) [`551f234`](https://github.com/tailor-platform/sdk/commit/551f234c3e594c7b191ff99207a2564182b62908) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update anthropics/claude-code-action action to v1.0.70

- [#684](https://github.com/tailor-platform/sdk/pull/684) [`48dda57`](https://github.com/tailor-platform/sdk/commit/48dda572fe70bb6504eac034ba32be5cb37a842e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @tailor-platform/function-types to v0.8.2

- [#686](https://github.com/tailor-platform/sdk/pull/686) [`0ffe758`](https://github.com/tailor-platform/sdk/commit/0ffe7584ba2c58c51ae27f544dafc8d6c0e0f52d) Thanks [@renovate](https://github.com/apps/renovate)! - Update @typescript/native-preview to v7.0.0-dev.20260306.1 and remove deprecated tsconfig options (`esModuleInterop`, `allowSyntheticDefaultImports`) for tsgo 7.x compatibility

- [#687](https://github.com/tailor-platform/sdk/pull/687) [`5e756a8`](https://github.com/tailor-platform/sdk/commit/5e756a874820594ebd86565607c4e23902e9c22a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.56.7

- [#688](https://github.com/tailor-platform/sdk/pull/688) [`b9b0759`](https://github.com/tailor-platform/sdk/commit/b9b0759479b6ec6f48a8b09d353126e511936762) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency pkg-pr-new to v0.0.65

- [#689](https://github.com/tailor-platform/sdk/pull/689) [`ccd55f7`](https://github.com/tailor-platform/sdk/commit/ccd55f7814f14ac024f3da434f797d9a4c088007) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency publint to v0.3.18

- [#690](https://github.com/tailor-platform/sdk/pull/690) [`dc2111a`](https://github.com/tailor-platform/sdk/commit/dc2111a79c20a4bfcefccaf2fb6b57480bc32542) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency rhysd/actionlint to v1.7.11

- [#694](https://github.com/tailor-platform/sdk/pull/694) [`b4a8c52`](https://github.com/tailor-platform/sdk/commit/b4a8c523c6ead4f2bd672336540db0f1182b04a6) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update eslint monorepo to v9.39.4

- [#695](https://github.com/tailor-platform/sdk/pull/695) [`e43ab99`](https://github.com/tailor-platform/sdk/commit/e43ab993d181abb837c70a031cb1a5cc95b1b298) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update suzuki-shunsuke/commit-action action to v0.1.1

- [#696](https://github.com/tailor-platform/sdk/pull/696) [`3b93367`](https://github.com/tailor-platform/sdk/commit/3b93367c23ebda117e277c5aa12bb8a30443b0ea) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update vitest monorepo to v4.0.18

- [#697](https://github.com/tailor-platform/sdk/pull/697) [`6c48ec7`](https://github.com/tailor-platform/sdk/commit/6c48ec745ffd07420ab1591ef9c94e2d41fc5e0f) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency confbox to v0.2.4

- [#698](https://github.com/tailor-platform/sdk/pull/698) [`ebeb9a3`](https://github.com/tailor-platform/sdk/commit/ebeb9a31fae493d45f6c010301b83283001d2fba) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.28.11

- [#699](https://github.com/tailor-platform/sdk/pull/699) [`7639610`](https://github.com/tailor-platform/sdk/commit/7639610d234c27b7df64e87144b7400391272610) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-rc.7

- [#703](https://github.com/tailor-platform/sdk/pull/703) [`6b19c90`](https://github.com/tailor-platform/sdk/commit/6b19c90acc2d505766c7c1c5c7caae3f18ebfeb7) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency serve to v14.2.6

- [#704](https://github.com/tailor-platform/sdk/pull/704) [`a963287`](https://github.com/tailor-platform/sdk/commit/a9632875973c1590b0232ba1bb0fe34feb219bc2) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency type-fest to v5.4.4

- [#705](https://github.com/tailor-platform/sdk/pull/705) [`40a654c`](https://github.com/tailor-platform/sdk/commit/40a654c757b69f8484bea44c763394179b926be4) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260307.1

- [#706](https://github.com/tailor-platform/sdk/pull/706) [`e6870b0`](https://github.com/tailor-platform/sdk/commit/e6870b06807a419dcff7602a8836ff250c31574e) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency zod to v4.3.6

- [#707](https://github.com/tailor-platform/sdk/pull/707) [`08b48d8`](https://github.com/tailor-platform/sdk/commit/08b48d8ba979188388a9135105a7042f9f64e259) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/setup-node action to v6.3.0

- [#658](https://github.com/tailor-platform/sdk/pull/658) [`4aadd81`](https://github.com/tailor-platform/sdk/commit/4aadd812e58256b19ca5dcd21a9ac37652910728) Thanks [@toiroakr](https://github.com/toiroakr)! - Generate TypeScript types from Zod schemas using zinfer, replacing manual z.infer/z.input/z.output usage

## 1.23.0

### Minor Changes

- [#661](https://github.com/tailor-platform/sdk/pull/661) [`03f33d9`](https://github.com/tailor-platform/sdk/commit/03f33d9c3d789c738c99600148aa52f2586017ea) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Add interactive REPL mode to `tailor-sdk query`.

  This allows running SQL queries statement-by-statement and GraphQL queries in an
  interactive session by omitting `--query`.

### Patch Changes

- [#677](https://github.com/tailor-platform/sdk/pull/677) [`cc6db64`](https://github.com/tailor-platform/sdk/commit/cc6db647361309021268543c291e1f13e9a6cb1c) Thanks [@dqn](https://github.com/dqn)! - Write tailor.d.ts to project root (next to config file) instead of SDK dist directory

- [#680](https://github.com/tailor-platform/sdk/pull/680) [`4d421a8`](https://github.com/tailor-platform/sdk/commit/4d421a8b904b939813b50fb68fff4bafccd10541) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): lock file maintenance

- [#691](https://github.com/tailor-platform/sdk/pull/691) [`008b2b6`](https://github.com/tailor-platform/sdk/commit/008b2b68d750a0799118087e09418d1f16574bb3) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency suzuki-shunsuke/ghalint to v1.5.5

## 1.22.0

### Minor Changes

- [#629](https://github.com/tailor-platform/sdk/pull/629) [`628a790`](https://github.com/tailor-platform/sdk/commit/628a790ec52a905ff97a0ab5441119855c670880) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `function test-run` CLI command to run functions on the Tailor Platform server without deploying. Auto-detects resolver, executor, workflow job, and plain function types (including `export function main`). Bundles the function using rolldown and executes via TestExecScript API. Also supports passing pre-bundled `.js` files directly to skip detection and bundling. Automatically injects `env` from config into all function type entries. Embeds machine user context (id, attributes, workspaceId) into resolver entries as `user` and into executor entries as `actor`, resolved from the API and config. Auth namespace is resolved automatically from `config.auth.name`. Fixes error/logs separation in script executor and shows Result section only on success to avoid duplicate output with Error section on failure.

- [#665](https://github.com/tailor-platform/sdk/pull/665) [`a7b4a9b`](https://github.com/tailor-platform/sdk/commit/a7b4a9b396aaf6d64343c2f4d4a55fb4216211be) Thanks [@toiroakr](https://github.com/toiroakr)! - Support multiple semicolon-separated SQL statements in `query` command with proper handling of semicolons inside string literals, and improve SQL parse error messages with guidance for reserved keywords

- [#589](https://github.com/tailor-platform/sdk/pull/589) [`39edc3f`](https://github.com/tailor-platform/sdk/commit/39edc3f2b7ec03159ffe1eafbdede77fa34c75fe) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - feat: add `query` command for SQL/GraphQL playground

  - Add new CLI subcommand: `tailor-sdk query`
  - Support query engines via `--engine sql | gql`
  - Execute query string via `--query` (`-q`)
    Usage examples:

  - SQL:
    `tailor-sdk query --engine sql -q "SELECT * FROM User" -m admin-machine-user`
  - GraphQL:
    `tailor-sdk query --engine gql -q "query { users { id name } }" -m admin-machine-user`

- [#666](https://github.com/tailor-platform/sdk/pull/666) [`ee458b4`](https://github.com/tailor-platform/sdk/commit/ee458b4c05049024a3fd48f85a5e93caa630a4af) Thanks [@dqn](https://github.com/dqn)! - Add test utilities for bundled function testing via `@tailor-platform/sdk/test`

  - `setupTailordbMock(resolver?)`: Mock `globalThis.tailordb.Client` for testing resolvers/executors that use DB queries
  - `setupWorkflowMock(handler)`: Mock `globalThis.tailor.workflow.triggerJobFunction` for testing workflow job triggers
  - `createImportMain(baseDir)`: Import bundled JS files and extract the `main` function for execution testing

- [#646](https://github.com/tailor-platform/sdk/pull/646) [`bc45c01`](https://github.com/tailor-platform/sdk/commit/bc45c018aa165aad02ae6e8ef44b1459d859a93a) Thanks [@dqn](https://github.com/dqn)! - Add shell completion metadata to CLI args and upgrade politty to v0.4.3

### Patch Changes

- [#663](https://github.com/tailor-platform/sdk/pull/663) [`7cf2df1`](https://github.com/tailor-platform/sdk/commit/7cf2df1a0429b0bed0065e31b9998c33ce0c237c) Thanks [@toiroakr](https://github.com/toiroakr)! - Add publint to validate package exports before publishing

- [#659](https://github.com/tailor-platform/sdk/pull/659) [`9fc3d02`](https://github.com/tailor-platform/sdk/commit/9fc3d02b99f2236f1f4f49e681ddbecec950c6b5) Thanks [@k1LoW](https://github.com/k1LoW)! - Add allowMicrosoftOauth support to IdP user auth policy

- [#662](https://github.com/tailor-platform/sdk/pull/662) [`514fb40`](https://github.com/tailor-platform/sdk/commit/514fb40e4733e6726f83a58587325b3119fae239) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix column ordering in SQL wildcard query results by sorting columns based on db.type() field definition order. Wildcards are expanded in-place preserving SQL declaration order, with system fields (id) first followed by user-defined fields. Supports both unqualified (`SELECT *`) and qualified (`SELECT u.*`) wildcards with alias resolution. Column matching is case-insensitive to handle unquoted SQL identifiers correctly.

- [#667](https://github.com/tailor-platform/sdk/pull/667) [`b516df2`](https://github.com/tailor-platform/sdk/commit/b516df2ee6b2ba8c77fed8df22cf2942fbb94a75) Thanks [@riku99](https://github.com/riku99)! - Skip application creation when no subgraphs are configured

- [#660](https://github.com/tailor-platform/sdk/pull/660) [`c38bfcc`](https://github.com/tailor-platform/sdk/commit/c38bfcc117bcac6d6d211267f3997ff11df1d8c7) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove `user` from `WorkflowJobContext` — the platform's workflow runtime does not inject a `user` global variable into the JS execution environment, so the field was always undefined. Also remove `WORKFLOW_TEST_USER_KEY` constant.

- [#619](https://github.com/tailor-platform/sdk/pull/619) [`4a686b7`](https://github.com/tailor-platform/sdk/commit/4a686b7e35d7c6bd5aaaea36d44827edae0db68c) Thanks [@riku99](https://github.com/riku99)! - Enable external constants/functions in TailorDB hooks and validators

- [#668](https://github.com/tailor-platform/sdk/pull/668) [`4f93a59`](https://github.com/tailor-platform/sdk/commit/4f93a594113aa99fb464e1202af379dbd92302df) Thanks [@riku99](https://github.com/riku99)! - Add strict() to all command arg schemas to reject unknown options

## 1.21.0

### Minor Changes

- [#649](https://github.com/tailor-platform/sdk/pull/649) [`4fd37bf`](https://github.com/tailor-platform/sdk/commit/4fd37bfa13d7d356c919491da7f5886830dce80a) Thanks [@toiroakr](https://github.com/toiroakr)! - Add OpenTelemetry tracing instrumentation to the generate command. Each phase (loadTypes, loadResolvers, loadExecutors, generators) is measured as a span, opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` with zero overhead when disabled. Refactor generator scheduling to align with the plugin hook model — generators are now called at each phase they subscribe to via their dependencies array, matching how plugins use onTailorDBReady/onResolverReady/onExecutorReady hooks.

- [#653](https://github.com/tailor-platform/sdk/pull/653) [`6b5f1db`](https://github.com/tailor-platform/sdk/commit/6b5f1dbb84f27559312b0868c9b8e7efbb5580a8) Thanks [@murayama-r](https://github.com/murayama-r)! - Add manual configuration for publishEvents on TailorDB types and resolvers

### Patch Changes

- [#651](https://github.com/tailor-platform/sdk/pull/651) [`3c8068d`](https://github.com/tailor-platform/sdk/commit/3c8068da663b28e73c6adaa0feb2fbd0934c860e) Thanks [@dqn](https://github.com/dqn)! - Guard undefined user global in workflow bundler entry

## 1.20.0

### Minor Changes

- [#644](https://github.com/tailor-platform/sdk/pull/644) [`e7ac6ae`](https://github.com/tailor-platform/sdk/commit/e7ac6aeabeb85786fff2e71629377a55c9a45bb3) Thanks [@dqn](https://github.com/dqn)! - Add bundle caching to accelerate apply command

### Patch Changes

- [#648](https://github.com/tailor-platform/sdk/pull/648) [`484cd98`](https://github.com/tailor-platform/sdk/commit/484cd989163b441385dd2794a9580716825de658) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `gqlOperations` option for IdP configuration

  Configure which GraphQL operations are enabled for IdP users. All operations are enabled by default (set `false` to disable):

  - `create`: Enable \_createUser mutation (default: true)
  - `update`: Enable \_updateUser mutation (default: true)
  - `delete`: Enable \_deleteUser mutation (default: true)
  - `read`: Enable \_users and \_user queries (default: true)
  - `sendPasswordResetEmail`: Enable \_sendPasswordResetEmail mutation (default: true)

  Supports `"query"` alias for read-only mode (disables all mutations):

  ```typescript
  defineIdp("my-idp", {
    authorization: "loggedIn",
    clients: ["my-client"],
    gqlOperations: "query", // Equivalent to { create: false, update: false, delete: false, read: true, sendPasswordResetEmail: false }
  });
  ```

- [#639](https://github.com/tailor-platform/sdk/pull/639) [`2d25e53`](https://github.com/tailor-platform/sdk/commit/2d25e534c34bc0297f95ead6f163e02b1567e93a) Thanks [@dqn](https://github.com/dqn)! - Refactor CLI internal directory layout to align with package-by-feature boundaries, colocating apply/generate command logic under commands and consolidating shared CLI helpers.

- [#650](https://github.com/tailor-platform/sdk/pull/650) [`55fb921`](https://github.com/tailor-platform/sdk/commit/55fb9210e4a0bd45a4d82d3f91df3930b4273d49) Thanks [@toiroakr](https://github.com/toiroakr)! - Add GitHub Actions workflow for automated dependency review on Renovate PRs using Claude

## 1.19.0

### Minor Changes

- [#633](https://github.com/tailor-platform/sdk/pull/633) [`5f0b84b`](https://github.com/tailor-platform/sdk/commit/5f0b84bea403f9d15a9802e9a1fd7b07e0c2a9d2) Thanks [@ikawaha](https://github.com/ikawaha)! - Add decimal field type support with optional scale parameter (0-12) for fixed-point precision

- [#631](https://github.com/tailor-platform/sdk/pull/631) [`9aded63`](https://github.com/tailor-platform/sdk/commit/9aded634276ad51786b2b1119c89be23d1ed26ff) Thanks [@toiroakr](https://github.com/toiroakr)! - Add OpenTelemetry tracing to CLI apply process for performance profiling

  - Implement opt-in OTLP tracing activated via `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
  - Use `@opentelemetry/api` built-in noop spans for zero overhead when tracing is disabled
  - Instrument all apply phases (build, plan, confirm, create/update, delete) with hierarchical spans
  - Add Connect-RPC interceptor for automatic RPC call tracing
  - Parallelize plan phase service calls and internal RPC calls for ~60% faster plan execution
  - Fix race condition in parallel plan phase with Promise-based memoization for loadTypes/loadExecutors

### Patch Changes

- [#642](https://github.com/tailor-platform/sdk/pull/642) [`7ca52a5`](https://github.com/tailor-platform/sdk/commit/7ca52a56f3dcf4b41cf9c495bfa9ca3f279c00f1) Thanks [@riku99](https://github.com/riku99)! - Remove NPM_TOKEN from .github/workflows/release.yml

- [#641](https://github.com/tailor-platform/sdk/pull/641) [`86d382c`](https://github.com/tailor-platform/sdk/commit/86d382ce261b7abd71c7d27b3d50cc83c9df3430) Thanks [@riku99](https://github.com/riku99)! - Allow configuring inline sourcemaps via `inlineSourcemap` in defineConfig

## 1.18.0

### Minor Changes

- [#617](https://github.com/tailor-platform/sdk/pull/617) [`a6a2fc3`](https://github.com/tailor-platform/sdk/commit/a6a2fc30e9b7ef475819c53a43de96bee4962afd) Thanks [@toiroakr](https://github.com/toiroakr)! - Unify Plugin and Generator systems with a simplified hook architecture. Definition-time hooks (`onTypeLoaded`, `onNamespaceLoaded`) generate TailorDB types, resolvers, and executors. Generation-time hooks (`onTailorDBReady`, `onResolverReady`, `onExecutorReady`) receive all finalized data at each pipeline phase and directly produce output files. Each hook runs at its natural pipeline phase regardless of what other hooks the same plugin implements, ensuring outputs from earlier phases are available to later phases. `defineGenerators()` is deprecated in favor of `definePlugins()` with generation hooks. Builtin plugins are moved to dedicated entry points (`@tailor-platform/sdk/plugin/kysely-type`, `@tailor-platform/sdk/plugin/enum-constants`, `@tailor-platform/sdk/plugin/file-utils`, `@tailor-platform/sdk/plugin/seed`) to avoid bundling the CLI layer when importing plugins in `tailor.config.ts`. Deprecated re-exports remain in `@tailor-platform/sdk/cli` for backward compatibility.

- [#632](https://github.com/tailor-platform/sdk/pull/632) [`6cc53d8`](https://github.com/tailor-platform/sdk/commit/6cc53d8ef372d62e3242eb764c91ea2a1d397550) Thanks [@toiroakr](https://github.com/toiroakr)! - Consolidate runtime args transformation into cli/bundler/runtime-args module, expose user context in WorkflowJobContext, and add WORKFLOW_TEST_USER_KEY for mocking user in workflow trigger tests

### Patch Changes

- [#636](https://github.com/tailor-platform/sdk/pull/636) [`43aaa26`](https://github.com/tailor-platform/sdk/commit/43aaa26681edc51f8459abe353f4f0c0ad1e803e) Thanks [@toiroakr](https://github.com/toiroakr)! - Set default maxPageSize (1000) for all paginated List API calls via fetchAll to work around server-side pagination bug in ListFunctionRegistries

- [#637](https://github.com/tailor-platform/sdk/pull/637) [`a74df5f`](https://github.com/tailor-platform/sdk/commit/a74df5f58fa4480439dfffe1b66213cb29820309) Thanks [@dqn](https://github.com/dqn)! - Categorize Zod validation errors using SDK brand symbols: branded values that fail schema validation now throw (indicating a user configuration bug), while non-branded values are silently skipped (unrelated files picked up by glob).

- [#635](https://github.com/tailor-platform/sdk/pull/635) [`329690b`](https://github.com/tailor-platform/sdk/commit/329690be4d38d348776560b0b3781717ca03c913) Thanks [@dqn](https://github.com/dqn)! - Migrate politty to v0.4 section-level documentation markers and update CLI docs generation.

## 1.17.1

### Patch Changes

- [#626](https://github.com/tailor-platform/sdk/pull/626) [`e37cbb9`](https://github.com/tailor-platform/sdk/commit/e37cbb9fb9f4ab94be684c33c50e048b1968d5d7) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support disablePasswordAuth field for IdP userAuthPolicy

- [#618](https://github.com/tailor-platform/sdk/pull/618) [`0e56dfc`](https://github.com/tailor-platform/sdk/commit/0e56dfc9636896be72487be404b6b04536eeb6ea) Thanks [@toiroakr](https://github.com/toiroakr)! - Introduce `WorkflowService` type and `createWorkflowService` factory to align workflow handling with the service pattern used by `ExecutorService`, `ResolverService`, and other services. Replace `Application.workflowConfig` with `Application.workflowService` that encapsulates workflow loading, data access, and log printing. Replace `getXXX()` methods with getter properties across all service types (`TailorDBService`, `ResolverService`, `ExecutorService`, `WorkflowService`).

## 1.17.0

### Minor Changes

- [#624](https://github.com/tailor-platform/sdk/pull/624) [`9b07d90`](https://github.com/tailor-platform/sdk/commit/9b07d909b4fa1a882ade656132c1179f02f4027b) Thanks [@dqn](https://github.com/dqn)! - Add typed API overloads to get/list/executions/jobs CLI commands

  - Add definition-object-based overloads to `getWorkflow`, `getExecutor`, `listExecutorJobs`, `getExecutorJob`, `watchExecutorJob`, and `listWorkflowExecutions`
  - Export new typed options: `GetWorkflowTypedOptions`, `GetExecutorTypedOptions`, `ListExecutorJobsTypedOptions`, `GetExecutorJobTypedOptions`, `WatchExecutorJobTypedOptions`, `ListWorkflowExecutionsTypedOptions`
  - Deprecate existing string-based options in favor of typed alternatives (backward compatible)

### Patch Changes

- [#586](https://github.com/tailor-platform/sdk/pull/586) [`7915b80`](https://github.com/tailor-platform/sdk/commit/7915b8037c23ac777df087d9bc678af44b044d5f) Thanks [@toiroakr](https://github.com/toiroakr)! - Refactor application initialization and fix generate command ordering

  - Split `defineApplication` (sync, lightweight) and `loadApplication` (async, full initialization)
  - Remove `MutableApplication` type cast and mutable closure state
  - Move plugin file generation logic into `PluginManager.generatePluginFiles()`
  - Extract `buildApplication`, `defineServices`, and `generatePluginFilesIfNeeded` helper functions
  - Fix `generate` command to restore interleaved type loading/generation flow instead of using `loadApplication()` which bundled before generators ran
  - Clean up: make `pluginExecutorFiles` private, remove unused re-export, fix stale comments

- [#612](https://github.com/tailor-platform/sdk/pull/612) [`62045eb`](https://github.com/tailor-platform/sdk/commit/62045eba4cb0a90632cc6f884d989a15671f138f) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(postinstall): correct import path and call signature for generateUserTypes

  - Fix import path from non-existent `dist/cli/api.mjs` to `dist/cli/lib.mjs`
  - Fix function call to use options object `{ config, configPath }` instead of positional arguments

- [#620](https://github.com/tailor-platform/sdk/pull/620) [`e1b7d79`](https://github.com/tailor-platform/sdk/commit/e1b7d7944a909a5e9a2e5915186dda64a60d4414) Thanks [@dqn](https://github.com/dqn)! - Add JSDoc comments to SDK configure APIs for improved LLM discoverability

- [#615](https://github.com/tailor-platform/sdk/pull/615) [`9e51758`](https://github.com/tailor-platform/sdk/commit/9e517586a95cdad724b9d63565124c35e268d6e8) Thanks [@toiroakr](https://github.com/toiroakr)! - Review and slim down CLAUDE.md based on Anthropic's best practices: remove duplicate patterns, fix inaccuracies, delete volatile/redundant info, and reduce from ~400 lines to ~70 lines by pointing to example/ instead of embedding code

## 1.16.0

### Minor Changes

- [#602](https://github.com/tailor-platform/sdk/pull/602) [`4174110`](https://github.com/tailor-platform/sdk/commit/4174110ae1d1410801de98f9df2020c1ee0a4ef8) Thanks [@remiposo](https://github.com/remiposo)! - Add `hasAny` / `not hasAny` permission operators for array-to-array comparison

  New permission operators that check whether two arrays share any common elements.

  Usage examples:

  - `[{ user: "roles" }, "hasAny", { record: "allowedRoles" }]` — allow access when the user's roles overlap with the record's allowed roles
  - `[{ user: "tags" }, "not hasAny", ["blocked", "suspended"]]` — deny access when the user's tags share any element with the blocked list
  - `[["admin", "editor"], "hasAny", { user: "roles" }]` — both operands can be string arrays

  Unlike `in` / `not in` (scalar vs array), `hasAny` / `not hasAny` compares two arrays and checks for intersection.

## 1.15.2

### Patch Changes

- [#597](https://github.com/tailor-platform/sdk/pull/597) [`8d4f911`](https://github.com/tailor-platform/sdk/commit/8d4f9111645df049d91808c7083a054bb0ad656a) Thanks [@riku99](https://github.com/riku99)! - Show clear error when record/oldRecord/newRecord operand is used in gqlPermission

- [#609](https://github.com/tailor-platform/sdk/pull/609) [`50f0aee`](https://github.com/tailor-platform/sdk/commit/50f0aee0f17a05afde5bbce2a9f1b42f03cee0e5) Thanks [@riku99](https://github.com/riku99)! - Add `function logs` CLI command to list and view function execution logs

## 1.15.1

### Patch Changes

- [#608](https://github.com/tailor-platform/sdk/pull/608) [`17fbd24`](https://github.com/tailor-platform/sdk/commit/17fbd243bd2925d3c4b6fe0d61f0a3ab24c3bece) Thanks [@k1LoW](https://github.com/k1LoW)! - Add validation to require allowedEmailDomains when allowGoogleOauth is enabled

## 1.15.0

### Minor Changes

- [#605](https://github.com/tailor-platform/sdk/pull/605) [`634699c`](https://github.com/tailor-platform/sdk/commit/634699c0519157a18b992df4e98718940fc6d013) Thanks [@toiroakr](https://github.com/toiroakr)! - Add TypeConfig/PluginConfig type parameters to Plugin interface and remove TailorField schema requirements

  - Add `Plugin<TypeConfig, PluginConfig>` type parameters for type-safe arbitrary config
  - Remove `configSchema`, `pluginConfigSchema`, and `configTypeTemplate` properties from Plugin interface
  - Merge `PluginWithConfig`/`PluginNamespaceOnly` into a single `Plugin` interface
  - Wire TypeConfig/PluginConfig through `processType`/`processNamespace` contexts
  - Remove TailorField-based runtime validation from plugin config processing
  - Introduce `TypePluginOutput` for processType (extends `PluginOutput` with `extends` field)
  - Make `PluginOutput` the base type without `extends` (used by processNamespace)
  - Use `TailorAnyDBField` for `PluginExtends.fields` type

- [#595](https://github.com/tailor-platform/sdk/pull/595) [`4e6e3e6`](https://github.com/tailor-platform/sdk/commit/4e6e3e62e3071060373571e7d9765938c37a9013) Thanks [@toiroakr](https://github.com/toiroakr)! - Use Function Registry service for script storage instead of embedding bundled scripts directly in pipeline/executor/workflow requests. Scripts are now registered in the Function Registry during apply, and services reference them by name via operationSourceRef/scriptRef fields.

### Patch Changes

- [#599](https://github.com/tailor-platform/sdk/pull/599) [`e73e8fe`](https://github.com/tailor-platform/sdk/commit/e73e8fef5daf056a00a3bb402d0c8ab0a58f96ee) Thanks [@dqn](https://github.com/dqn)! - Add typed programmatic CLI APIs for workflow and executor operations while preserving legacy option shapes for backward compatibility.

- [#601](https://github.com/tailor-platform/sdk/pull/601) [`151102b`](https://github.com/tailor-platform/sdk/commit/151102bedca42457f02f6e503025908a40d5d1a4) Thanks [@riku99](https://github.com/riku99)! - Fixes an issue where nested field hooks/validate were dropped when generating TailorDB proto manifests

- [#606](https://github.com/tailor-platform/sdk/pull/606) [`4761d2b`](https://github.com/tailor-platform/sdk/commit/4761d2bab2d8d8fa7c5ce249db28e0a8f28dfc5a) Thanks [@toiroakr](https://github.com/toiroakr)! - Add lefthook post-commit hook to verify commit signatures and update CLAUDE.md with signing rules

## 1.14.2

### Patch Changes

- [#603](https://github.com/tailor-platform/sdk/pull/603) [`b093524`](https://github.com/tailor-platform/sdk/commit/b093524b2535dea2937b63ee62b300a6f0654cf0) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support allowGoogleOauth field for IdP userAuthPolicy

- [#598](https://github.com/tailor-platform/sdk/pull/598) [`b32223a`](https://github.com/tailor-platform/sdk/commit/b32223ac5735959e39c934bee3b30562c7c2b990) Thanks [@toiroakr](https://github.com/toiroakr)! - Prevent e2e-ws- workspace accumulation by separating SDK e2e tests into a dedicated CI workflow

- [#596](https://github.com/tailor-platform/sdk/pull/596) [`aecbfb7`](https://github.com/tailor-platform/sdk/commit/aecbfb73c184a9e36dfecd12580729783425a10e) Thanks [@dqn](https://github.com/dqn)! - Add `tailor-sdk` agent skill support and the `tailor-sdk-skills` shortcut installer command.

- [#592](https://github.com/tailor-platform/sdk/pull/592) [`ca758ed`](https://github.com/tailor-platform/sdk/commit/ca758ed7870dbb32364840d4b0eca465808bee13) Thanks [@toiroakr](https://github.com/toiroakr)! - Add getGeneratedType helper function for plugin-generated types

  - Add async `getGeneratedType(configPath, pluginId, sourceType, kind)` function to retrieve plugin-generated types
  - Auto-resolve namespace and pluginConfig from tailor.config.ts
  - Support both type-attached plugins (with sourceType) and namespace plugins (sourceType is null)
  - Rename `process` to `processType` and `config` to `typeConfig` in plugin context
  - Simplify `PluginNamespaceProcessContext` by removing `types` and `generatedTypes` parameters
  - Results are cached per config path, plugin, namespace, and pluginConfig

- [#578](https://github.com/tailor-platform/sdk/pull/578) [`a2f28c8`](https://github.com/tailor-platform/sdk/commit/a2f28c8b1ec72859271d096ddf1b0299ed83d0ca) Thanks [@riku99](https://github.com/riku99)! - Replace z.unknown() with typed Zod schemas in TailorDB schema

## 1.14.1

### Patch Changes

- [#587](https://github.com/tailor-platform/sdk/pull/587) [`014d8db`](https://github.com/tailor-platform/sdk/commit/014d8db10d2fb8a19ffff4a5c2d3c76c4f24f72d) Thanks [@toiroakr](https://github.com/toiroakr)! - Use tailor.idp.Client for IDP user seeding and truncation in seed generator

## 1.14.0

### Minor Changes

- [#557](https://github.com/tailor-platform/sdk/pull/557) [`e5dfa62`](https://github.com/tailor-platform/sdk/commit/e5dfa6263dba4644e79f1bfaf03a71ab40421019) Thanks [@dqn](https://github.com/dqn)! - Add a new `completion` subcommand to the CLI so users can generate shell completion scripts for their environment.

- [#577](https://github.com/tailor-platform/sdk/pull/577) [`1d969ac`](https://github.com/tailor-platform/sdk/commit/1d969ac5b6b2fd26919ef1ad5dcb4ce97c6734fe) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: snapshot-based migration apply

  - Extend snapshot schema (v2) to include relationships, permissions, files, hooks, and validation rules
  - Generate proto manifests directly from snapshots for migration-based deployments
  - Add support for index, file, relationship, and permission diff kinds
  - Separate migration e2e test templates from example app migrations

## 1.13.0

### Minor Changes

- [#580](https://github.com/tailor-platform/sdk/pull/580) [`74c2dfc`](https://github.com/tailor-platform/sdk/commit/74c2dfcb3e33d8d2548d7a948e5e322745e4a54c) Thanks [@toiroakr](https://github.com/toiroakr)! - Always generate exec.mjs for seed generator and add --machine-user option

  - exec.mjs is now generated regardless of whether `machineUserName` is configured
  - Added `--machine-user` (`-m`) CLI option to specify machine user at runtime
  - CLI argument takes precedence over config default, allowing override
  - Shows clear error message when machine user is not specified and not configured

## 1.12.0

### Minor Changes

- [#579](https://github.com/tailor-platform/sdk/pull/579) [`1d37a95`](https://github.com/tailor-platform/sdk/commit/1d37a954208c1e6ae64bac7afda604311d95e2cc) Thanks [@dqn](https://github.com/dqn)! - Make TailorDBField fluent API immutable

  Fluent methods (`description()`, `index()`, `unique()`, `hooks()`, `validate()`, `serial()`, `vector()`, `relation()`) now return new instances instead of mutating `this`, preventing shared field corruption when the same field is used across multiple types.

- [#575](https://github.com/tailor-platform/sdk/pull/575) [`43d4795`](https://github.com/tailor-platform/sdk/commit/43d4795543b1427edf661dc495e89e60a1406305) Thanks [@k1LoW](https://github.com/k1LoW)! - Handle OAuth2 client type changes with delete-recreate

  OAuth2 clients cannot update their clientType in-place on the server. This change detects clientType changes and handles them as replace operations (delete then create) during the create-update phase. Also adds deletion warnings for OAuth2 clients similar to TailorDB types and StaticWebsites.

- [#556](https://github.com/tailor-platform/sdk/pull/556) [`b2183b3`](https://github.com/tailor-platform/sdk/commit/b2183b3975fa993d2a61035d90d6b6a4002a852a) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add TailorDB plugin system (beta), including plugin config, code generation, and apply integration.

### Patch Changes

- [#564](https://github.com/tailor-platform/sdk/pull/564) [`6be4cac`](https://github.com/tailor-platform/sdk/commit/6be4cacd3037f6230be1f3ddc24fdb75629e4f2a) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: add TailorDB migration e2e workflow and adjust apply ordering for migrations.

- [#563](https://github.com/tailor-platform/sdk/pull/563) [`15fa518`](https://github.com/tailor-platform/sdk/commit/15fa518f6b0de2daf43eb1d41b3991ac867ed11a) Thanks [@riku99](https://github.com/riku99)! - Bundle optional peer dependencies with the SDK

- [#574](https://github.com/tailor-platform/sdk/pull/574) [`6e5c4ee`](https://github.com/tailor-platform/sdk/commit/6e5c4eecedda91bd7544102b2c4e58bfe7eeff7d) Thanks [@riku99](https://github.com/riku99)! - Remove unnecessary tests

- [#576](https://github.com/tailor-platform/sdk/pull/576) [`b909cdb`](https://github.com/tailor-platform/sdk/commit/b909cdb24e2d415af26a0f2237dfd012b5a78692) Thanks [@dqn](https://github.com/dqn)! - Add automatic chunking for seed data to avoid gRPC message size limits

  Large seed data that exceeds the 4MB gRPC message size limit is now automatically split into smaller chunks and sent in multiple requests.

## 1.11.1

### Patch Changes

- [#548](https://github.com/tailor-platform/sdk/pull/548) [`58a8094`](https://github.com/tailor-platform/sdk/commit/58a8094ea66d992e59753f95d9d0457824d67f5c) Thanks [@riku99](https://github.com/riku99)! - Add clone method tests for TailorDBField

- [#571](https://github.com/tailor-platform/sdk/pull/571) [`3d030a6`](https://github.com/tailor-platform/sdk/commit/3d030a6437e80fae3007a7ece7d79ac428a27942) Thanks [@remiposo](https://github.com/remiposo)! - Document workflow job input/output type constraints

## 1.11.0

### Minor Changes

- [#531](https://github.com/tailor-platform/sdk/pull/531) [`a3066a3`](https://github.com/tailor-platform/sdk/commit/a3066a399cb26ef91da1e871da0616311b104c26) Thanks [@toiroakr](https://github.com/toiroakr)! - Add executor list, get, and webhook commands to CLI

### Patch Changes

- [#569](https://github.com/tailor-platform/sdk/pull/569) [`cec1970`](https://github.com/tailor-platform/sdk/commit/cec1970581e39caedf84a1c89e0dbdbd5c53c0c0) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix BigInt serialization in error logging for API requests

## 1.10.1

### Patch Changes

- [#567](https://github.com/tailor-platform/sdk/pull/567) [`480309f`](https://github.com/tailor-platform/sdk/commit/480309f4d085bf05fbc00e7f215778a22ffd424a) Thanks [@k1LoW](https://github.com/k1LoW)! - Add schema validation to reject `requireDpop: true` for browser client type in OAuth2 client configuration. Browser clients don't support DPoP, and this validation provides early feedback at the SDK level before deployment.

## 1.10.0

### Minor Changes

- [#554](https://github.com/tailor-platform/sdk/pull/554) [`4e9f975`](https://github.com/tailor-platform/sdk/commit/4e9f975944981d2fce6f5a9b6c0785a2567cf44c) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(seed): use testExecScript API with Kysely batch insert for seeding

  - Replace gql-ingest with Kysely batch insert for TailorDB seeding (100 rows/batch)
  - Use direct fetch() for \_User seeding instead of gql-ingest
  - Add topological sort for type insertion order

### Patch Changes

- [#565](https://github.com/tailor-platform/sdk/pull/565) [`533227b`](https://github.com/tailor-platform/sdk/commit/533227b71a079f8d1b1b471980fa369dca2829fb) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support allowedEmailDomains field for IdP userAuthPolicy

- [#562](https://github.com/tailor-platform/sdk/pull/562) [`ce1eed0`](https://github.com/tailor-platform/sdk/commit/ce1eed0348f93d86e0bf7210be60223bae223955) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(cli): use separate case statements for retry error codes

  The `isRetirable` function was using bitwise OR in a switch case, which only matches the bitwise OR result rather than either code individually. This fix ensures retries work correctly for both `ResourceExhausted` and `Unavailable` error codes.

- [#547](https://github.com/tailor-platform/sdk/pull/547) [`5891c27`](https://github.com/tailor-platform/sdk/commit/5891c2774db182d1be1ea648b96b84dce1be5e34) Thanks [@riku99](https://github.com/riku99)! - Add tests for loadAccessToken

## 1.9.3

### Patch Changes

- [#550](https://github.com/tailor-platform/sdk/pull/550) [`6c532f5`](https://github.com/tailor-platform/sdk/commit/6c532f58a5113b8e944eb3d6f4f8d1627f937d1e) Thanks [@toiroakr](https://github.com/toiroakr)! - Add validation error when `.unique()` is combined with `n-1` (manyToOne) relation. Use `1-1` (oneToOne) relation instead for unique foreign keys.

- [#551](https://github.com/tailor-platform/sdk/pull/551) [`67b9ce0`](https://github.com/tailor-platform/sdk/commit/67b9ce038315252c44622b2ddcfadac890d2d6f1) Thanks [@riku99](https://github.com/riku99)! - Use changeset publish for git tag and GitHub release creation

## 1.9.2

### Patch Changes

- [#537](https://github.com/tailor-platform/sdk/pull/537) [`3c71c49`](https://github.com/tailor-platform/sdk/commit/3c71c49799c77053659e2e798edaf736fad0f2b5) Thanks [@riku99](https://github.com/riku99)! - Update release workflow to use changesets action for publishing and GitHub releases

## 1.9.1

### Patch Changes

- [#534](https://github.com/tailor-platform/sdk/pull/534) [`67b1935`](https://github.com/tailor-platform/sdk/commit/67b1935800d2ac6b6436bc66cdf41911572594ee) Thanks [@riku99](https://github.com/riku99)! - Add unit tests for TailorDB ERD schema generation (columns and schema building)

- [#533](https://github.com/tailor-platform/sdk/pull/533) [`9dbfc53`](https://github.com/tailor-platform/sdk/commit/9dbfc5375e04faf94eb2747875ebbe3eb990b8a1) Thanks [@riku99](https://github.com/riku99)! - Added tests for TailorDB parse runtime validation cases

- [#527](https://github.com/tailor-platform/sdk/pull/527) [`78b07f8`](https://github.com/tailor-platform/sdk/commit/78b07f8be371850b5c2d28d12459e07b5d17eaaf) Thanks [@riku99](https://github.com/riku99)! - Add tests for loadWorkspaceId in context

## 1.9.0

### Minor Changes

- [#516](https://github.com/tailor-platform/sdk/pull/516) [`425ead7`](https://github.com/tailor-platform/sdk/commit/425ead7f90c408605027537ee0e157b9d35651b6) Thanks [@jackchuka](https://github.com/jackchuka)! - Add support for configuring GraphQL operations on TailorDB types

  - Add `gqlOperations` option to `.features()` for granular control (true = enabled, false = disabled)
  - Add `"query"` alias for read-only mode: `gqlOperations: "query"` disables all mutations while keeping read enabled
  - Add `gqlOperations` option to `TailorDBServiceConfig` for namespace-level defaults
  - Regenerate proto definitions from latest `tailor-inc/proto`

## 1.8.0

### Minor Changes

- [#515](https://github.com/tailor-platform/sdk/pull/515) [`fce8058`](https://github.com/tailor-platform/sdk/commit/fce80580d49d784feb232918341c5643da2d96dc) Thanks [@toiroakr](https://github.com/toiroakr)! - Add Kysely utility types (Transaction, Insertable, Selectable, Updateable) to generated code

- [#521](https://github.com/tailor-platform/sdk/pull/521) [`fa17d60`](https://github.com/tailor-platform/sdk/commit/fa17d601d8e3a13e593eb5f1da6cbf5c6802a034) Thanks [@toiroakr](https://github.com/toiroakr)! - Add `display` option to `logger.out` for field transformation and exclusion in non-JSON mode

### Patch Changes

- [#519](https://github.com/tailor-platform/sdk/pull/519) [`3124bb2`](https://github.com/tailor-platform/sdk/commit/3124bb2bd755fe9fe9f781b6dadc28472d11969b) Thanks [@riku99](https://github.com/riku99)! - Normalized packages/sdk/src/cli/application/index.ts imports to use parser and enabled the ESLint/Oxlint rule blocking cli → configure imports (tests excluded).

- [#508](https://github.com/tailor-platform/sdk/pull/508) [`49d3fd5`](https://github.com/tailor-platform/sdk/commit/49d3fd5a255607145ce28c895dbdd2d94bea80b7) Thanks [@haru0017](https://github.com/haru0017)! - Transform webhook args `raw_body` to `rawBody` in executor bundler

- [#484](https://github.com/tailor-platform/sdk/pull/484) [`56ee4ff`](https://github.com/tailor-platform/sdk/commit/56ee4ff2dc23bd275ef9556c47363315e9d4e981) Thanks [@riku99](https://github.com/riku99)! - Updated imports of confgure tailordb and resolver in cli

## 1.7.0

### Minor Changes

- [#503](https://github.com/tailor-platform/sdk/pull/503) [`d6d16e2`](https://github.com/tailor-platform/sdk/commit/d6d16e26f329088926eb07d89d0c7dbbefc0bcd5) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - reject configs with both userProfile and machineUserAttributes

### Patch Changes

- [#512](https://github.com/tailor-platform/sdk/pull/512) [`8cf6a9b`](https://github.com/tailor-platform/sdk/commit/8cf6a9b52075dd511f691709eb5779e9b05ce767) Thanks [@toiroakr](https://github.com/toiroakr)! - Improve CLI table output formatting: humanize Date fields, pretty-print JSON objects, and output empty array in JSON mode for list commands

- [#502](https://github.com/tailor-platform/sdk/pull/502) [`080053f`](https://github.com/tailor-platform/sdk/commit/080053fb56fcc9fd28bcd1b1400094a8c35d4d17) Thanks [@riku99](https://github.com/riku99)! - Add workspace info to show command'

- [#509](https://github.com/tailor-platform/sdk/pull/509) [`502050f`](https://github.com/tailor-platform/sdk/commit/502050f0946a1c314ef4c8d2a79ce924973b0daa) Thanks [@riku99](https://github.com/riku99)! - Delete profile when deleting workspace

## 1.6.3

### Patch Changes

- [#505](https://github.com/tailor-platform/sdk/pull/505) [`c3329a9`](https://github.com/tailor-platform/sdk/commit/c3329a991ab7fc2f60dc4558ba33ea60ed18394e) Thanks [@k1LoW](https://github.com/k1LoW)! - Add actor field to executor event trigger args

  - Added `TailorActor` type to represent actors in event triggers
  - Added `actor` field to `EventArgs` interface (nullable)
  - Field names are aligned with `TailorUser` for consistency (`attributes`, `attributeList`)
  - Added transformation in executor bundler to convert server field names to SDK field names

- [#489](https://github.com/tailor-platform/sdk/pull/489) [`2f17481`](https://github.com/tailor-platform/sdk/commit/2f17481f26577249c8dd0ac93d1b04b0f91cb377) Thanks [@riku99](https://github.com/riku99)! - Moved executor service config types to parser and updated CLI imports

## 1.6.2

### Patch Changes

- [#498](https://github.com/tailor-platform/sdk/pull/498) [`254fb04`](https://github.com/tailor-platform/sdk/commit/254fb048302668cd15298138baa9bff77a90bec5) Thanks [@dqn](https://github.com/dqn)! - Migrate CLI framework from citty to politty

## 1.6.1

### Patch Changes

- [#499](https://github.com/tailor-platform/sdk/pull/499) [`b8c3e77`](https://github.com/tailor-platform/sdk/commit/b8c3e77400c86577cd9609924fd0ee29885fe74b) Thanks [@k1LoW](https://github.com/k1LoW)! - Add IdP and Auth event triggers for executor

  New trigger functions:

  - `idpUserCreatedTrigger()` - fires when an IdP user is created
  - `idpUserUpdatedTrigger()` - fires when an IdP user is updated
  - `idpUserDeletedTrigger()` - fires when an IdP user is deleted
  - `authAccessTokenIssuedTrigger()` - fires when an access token is issued
  - `authAccessTokenRefreshedTrigger()` - fires when an access token is refreshed
  - `authAccessTokenRevokedTrigger()` - fires when an access token is revoked

## 1.6.0

### Minor Changes

- [#462](https://github.com/tailor-platform/sdk/pull/462) [`f83a3ed`](https://github.com/tailor-platform/sdk/commit/f83a3ed25a0c3019a97aaada32d5398db12865ba) Thanks [@toiroakr](https://github.com/toiroakr)! - Add TailorDB schema migration feature (beta). Migrations allow you to safely evolve your database schema with type-safe data transformations.

  > **Note:** This feature is currently in beta. The API and behavior may change in future releases.

  **Key Features:**

  - **Local snapshot-based diff detection** - Detects field-level schema differences between current types and previous snapshots
  - **Type-safe migration scripts** - Generates TypeScript migration scripts with Kysely transaction types
  - **Transaction-wrapped execution** - All changes commit or rollback together for atomicity
  - **Automatic execution during apply** - Pending migrations run as part of `tailor-sdk apply`
  - **Migration checkpoint management** - Manually control which migrations have been applied
  - **Migration status tracking** - View current state and pending migrations

  **Commands:**

  - `tailordb migration generate` - Generate migration files from schema changes (supports `--name`, `--yes`, `--init`)
  - `tailordb migration set <number>` - Manually set migration checkpoint
  - `tailordb migration status` - Show migration status and pending migrations

  **Supported Schema Changes:**

  The migration system automatically handles:

  - Adding/removing optional fields (non-breaking)
  - Adding required fields (breaking - migration script generated)
  - Changing optional→required (breaking - migration script generated)
  - Adding/removing indexes (non-breaking)
  - Adding unique constraints (breaking - migration script generated)
  - Adding/removing enum values (removing is breaking - migration script generated)
  - Adding/removing types (non-breaking)

  **Unsupported Changes:**

  The following changes require a 3-step migration process:

  - **Field type changes** (e.g., `string` → `integer`) - Add new field, migrate data, remove old field, then re-add with original name
  - **Array to single value changes** - Add new single-value field, migrate data, remove array field, then re-add with original name

  **Configuration:**

  Configure migrations in `tailor.config.ts`:

  ```typescript
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
      migration: {
        directory: "./migrations",
        // Optional: specify machine user for migration execution
        // If not specified, the first machine user from auth.machineUsers is used
        machineUser: "admin-machine-user",
      },
    },
  }
  ```

### Patch Changes

- [#488](https://github.com/tailor-platform/sdk/pull/488) [`f26a33d`](https://github.com/tailor-platform/sdk/commit/f26a33d1519d444f03e0e40cf43b16b2f5693348) Thanks [@riku99](https://github.com/riku99)! - Moved workflow service config types to the parser layer and updated CLI imports

- [#493](https://github.com/tailor-platform/sdk/pull/493) [`8111b0f`](https://github.com/tailor-platform/sdk/commit/8111b0f69bd924db51283b16eb20b650384ad3a1) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: improve ERD command UX

  - Allow `erd export` and `erd serve` to work without `erdSite` configuration (only `erd deploy` requires it)
  - Suppress verbose liam CLI output during ERD build
  - Improve `erd export` log output with success message for build path

## 1.5.0

### Minor Changes

- [#479](https://github.com/tailor-platform/sdk/pull/479) [`bb984f5`](https://github.com/tailor-platform/sdk/commit/bb984f59421999709be389febc23bbadfc5d91e5) Thanks [@r253hmdryou](https://github.com/r253hmdryou)! - Support machine users without userProfile via new machineUserAttributes field

  Adds machineUserAttributes configuration option for defining type-safe machine-user-only authentication without requiring a userProfile.

- [#478](https://github.com/tailor-platform/sdk/pull/478) [`dce0040`](https://github.com/tailor-platform/sdk/commit/dce0040f0477c2603b604ab3aac17383ec03f3e7) Thanks [@toiroakr](https://github.com/toiroakr)! - Add local testing support for workflows

  - `createWorkflowJob`: `.trigger()` now executes body directly for local testing
  - `createWorkflow`: `.trigger()` now calls `mainJob.trigger()` for local testing
  - Export `WORKFLOW_TEST_ENV_KEY` from `@tailor-platform/sdk/test` for env configuration
  - Add workflow trigger test examples to testing template

### Patch Changes

- [#474](https://github.com/tailor-platform/sdk/pull/474) [`a41a320`](https://github.com/tailor-platform/sdk/commit/a41a3205d093a5ae6e864d96687fe87f1af81bf4) Thanks [@riku99](https://github.com/riku99)! - Moved AppConfig into packages/sdk/src/parser/\*\* and imports in cli'

- [#482](https://github.com/tailor-platform/sdk/pull/482) [`43afdae`](https://github.com/tailor-platform/sdk/commit/43afdaeccd6a68500721cfe17e27149fe6a44c43) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `publishUserEvents` option for IdP configuration

  When enabled, user lifecycle events (created, updated, deleted) are published to the dataplane event topic.

- [#471](https://github.com/tailor-platform/sdk/pull/471) [`e2c5e83`](https://github.com/tailor-platform/sdk/commit/e2c5e83b85fb835652e06d78290a41a9fc06fb3e) Thanks [@dqn](https://github.com/dqn)! - Refactor class-based implementations to factory functions

  - Convert service classes (AuthService, ExecutorService, ResolverService, TailorDBService) to factory functions
  - Convert Application class to factory function
  - Convert generator classes to factory functions
  - Convert TailorField, TailorDBField, TailorDBType classes to interfaces with factory functions
  - Introduce Symbol branding for reliable type identification
  - Normalize undefined to null for optional fields

- [#483](https://github.com/tailor-platform/sdk/pull/483) [`fe8d1c5`](https://github.com/tailor-platform/sdk/commit/fe8d1c5a940855be935bac4d02115317ce0edf88) Thanks [@riku99](https://github.com/riku99)! - Moved getDistDir to cli utils and updated imports

## 1.4.2

### Patch Changes

- [#470](https://github.com/tailor-platform/sdk/pull/470) [`2e56c13`](https://github.com/tailor-platform/sdk/commit/2e56c13377d713463a993bf8e1999b942ad9236c) Thanks [@riku99](https://github.com/riku99)! - Create profile when create workspace

- [#461](https://github.com/tailor-platform/sdk/pull/461) [`1843602`](https://github.com/tailor-platform/sdk/commit/184360246de148baab96c8984da4f8b281ff4821) Thanks [@riku99](https://github.com/riku99)! - Add CLI command to open tailor platform console via `pnpm tailor-sdk open`

## 1.4.1

### Patch Changes

- [#464](https://github.com/tailor-platform/sdk/pull/464) [`eecb5a4`](https://github.com/tailor-platform/sdk/commit/eecb5a476befde51fcc11d6e2d1edb4c48aa97f3) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(cli): improve error message when workflow mainJob is not found

- [#457](https://github.com/tailor-platform/sdk/pull/457) [`43c3ba5`](https://github.com/tailor-platform/sdk/commit/43c3ba545e43a4ccd8a8b6b01722066adfd3e73c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.460.1

- [#459](https://github.com/tailor-platform/sdk/pull/459) [`3e596c5`](https://github.com/tailor-platform/sdk/commit/3e596c5e16896d998544efb2d6574750be61a1dc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260118.1

- [#460](https://github.com/tailor-platform/sdk/pull/460) [`6b71d69`](https://github.com/tailor-platform/sdk/commit/6b71d693dcffe64be56b94e045afcc9766baf591) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency kysely to v0.28.10

- [#465](https://github.com/tailor-platform/sdk/pull/465) [`fe91cfd`](https://github.com/tailor-platform/sdk/commit/fe91cfd63ed57901c0985a1cb58bcf610c12f22f) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update changesets/action action to v1.6.0

- [#466](https://github.com/tailor-platform/sdk/pull/466) [`f13544e`](https://github.com/tailor-platform/sdk/commit/f13544eeb1d550421a951e82869aa589de1c849a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v5.82.0

## 1.4.0

### Minor Changes

- [#452](https://github.com/tailor-platform/sdk/pull/452) [`2428441`](https://github.com/tailor-platform/sdk/commit/2428441fd9df34428520adc578c6016f448f776c) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(seed): improve exec script with colors and embedded config

  - Remove yaml package dependency by embedding entity config in exec.mjs
  - Replace entityNamespaces with namespaceEntities (Map<namespace, entities[]>)
  - Add --yes flag to skip confirmation prompts
  - Use node:util styleText for colored output (cyan, green, red, yellow, dim)
  - Remove config.yaml generation (no longer needed)
  - Improve array formatting in namespaceEntities (one element per line)

### Patch Changes

- [#453](https://github.com/tailor-platform/sdk/pull/453) [`9589142`](https://github.com/tailor-platform/sdk/commit/95891421eb3bcd645d6a15dbad2935fee9cd7a90) Thanks [@riku99](https://github.com/riku99)! - Updated jsdoc rules and jsdoc comments

- [#451](https://github.com/tailor-platform/sdk/pull/451) [`46b42c4`](https://github.com/tailor-platform/sdk/commit/46b42c4e157026b891490e9ebc080dc8bbf05513) Thanks [@k1LoW](https://github.com/k1LoW)! - Add `publishSessionEvents` option to auth configuration

- [#446](https://github.com/tailor-platform/sdk/pull/446) [`d57daaa`](https://github.com/tailor-platform/sdk/commit/d57daaaefa48744a0918a409f726564867759955) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.64.0

- [#447](https://github.com/tailor-platform/sdk/pull/447) [`58dc5e1`](https://github.com/tailor-platform/sdk/commit/58dc5e1ffefd3c483c4dcd244a45742c01c52918) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @jackchuka/gql-ingest to v3

- [#448](https://github.com/tailor-platform/sdk/pull/448) [`3e27e60`](https://github.com/tailor-platform/sdk/commit/3e27e60a639291b6efe0ceef9ff6321f01ada338) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.7.5

- [#450](https://github.com/tailor-platform/sdk/pull/450) [`89e315c`](https://github.com/tailor-platform/sdk/commit/89e315c49c659790dc9448a90dcd89788ad7134e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260117.1

- [#454](https://github.com/tailor-platform/sdk/pull/454) [`e6bfac2`](https://github.com/tailor-platform/sdk/commit/e6bfac254900e301def16b8b7f9dbacea70e8fbf) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.56.5

- [#455](https://github.com/tailor-platform/sdk/pull/455) [`386c5bf`](https://github.com/tailor-platform/sdk/commit/386c5bf728a1e9a95febb52468af6921718b22fe) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.459.0

- [#456](https://github.com/tailor-platform/sdk/pull/456) [`77ee396`](https://github.com/tailor-platform/sdk/commit/77ee396d645248dad1f201f7d219b036e66a6f93) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint-plugin-jsdoc to v62.1.0

## 1.3.0

### Minor Changes

- [#422](https://github.com/tailor-platform/sdk/pull/422) [`a079415`](https://github.com/tailor-platform/sdk/commit/a079415b50c882312b8a09917d7bd7c521393e2f) Thanks [@remiposo](https://github.com/remiposo)! - Add `--env-file-if-exists` option for optional environment file loading

  Added a new CLI option `--env-file-if-exists` that loads environment files only if they exist, without throwing an error when the file is missing. This is useful for loading optional local configuration files like `.env.local`.

  Environment file loading now follows Node.js `--env-file` behavior:

  - Variables already set in the environment are not overwritten
  - Later files override earlier files when multiple are specified

### Patch Changes

- [#427](https://github.com/tailor-platform/sdk/pull/427) [`6ac8385`](https://github.com/tailor-platform/sdk/commit/6ac83855489055ffa01697b9b3781faa29720545) Thanks [@remiposo](https://github.com/remiposo)! - Use pathe for cross-platform path handling

  Replaced `node:path` with `pathe` across CLI modules to ensure consistent path separator handling on all operating systems. This eliminates the need for manual path separator normalization (e.g., `.replace(/\\/g, "/")`) and improves reliability on Windows.

- [#435](https://github.com/tailor-platform/sdk/pull/435) [`79181a1`](https://github.com/tailor-platform/sdk/commit/79181a1e4f5d383e51bf451f97297225889df871) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix workflow job test implementations to match descriptions

  Updated two test cases in workflow job type tests to properly validate optional field handling:

  - "allows multiple optional fields in input": now actually tests multiple optional fields in input parameters
  - "allows nested objects with optional fields": now tests nested optional field structures in input parameters

  This ensures test descriptions accurately reflect what is being tested.

- [#440](https://github.com/tailor-platform/sdk/pull/440) [`66b44da`](https://github.com/tailor-platform/sdk/commit/66b44dadf6667eccac324e843c264a9b4d902d3c) Thanks [@riku99](https://github.com/riku99)! - Update CLAUDE.md for oxlint migration

- [#421](https://github.com/tailor-platform/sdk/pull/421) [`b3853e0`](https://github.com/tailor-platform/sdk/commit/b3853e024172c1c184501092627afd4e9ad45931) Thanks [@toiroakr](https://github.com/toiroakr)! - docs: improve TailorDB hooks and validation documentation

  - Add practical examples using function arguments (value, data, user)
  - Split hooks and validation sections into field-level and type-level subsections
  - Clarify that field-level hooks have `data` as `unknown` type
  - Add warnings that field-level and type-level configurations cannot coexist on the same field

- [#417](https://github.com/tailor-platform/sdk/pull/417) [`c644157`](https://github.com/tailor-platform/sdk/commit/c6441573f235640eb8336f64d03f132984f51292) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/setup-node action to v6.2.0

- [#418](https://github.com/tailor-platform/sdk/pull/418) [`0292001`](https://github.com/tailor-platform/sdk/commit/0292001dff866bda80e1d2fe868ce2d9dc33e239) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260112.1

- [#424](https://github.com/tailor-platform/sdk/pull/424) [`7577497`](https://github.com/tailor-platform/sdk/commit/7577497c1f74e5fdb4db2177f7689958ef4318fb) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency lefthook to v2.0.14

- [#428](https://github.com/tailor-platform/sdk/pull/428) [`d4a7f9b`](https://github.com/tailor-platform/sdk/commit/d4a7f9bac1b3dc63af6a089c3ea911bd68765db5) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.455.0

- [#437](https://github.com/tailor-platform/sdk/pull/437) [`908ecae`](https://github.com/tailor-platform/sdk/commit/908ecaef4a4df2e1c373f22773aee95fe19de584) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.56.4

- [#438](https://github.com/tailor-platform/sdk/pull/438) [`bfe4872`](https://github.com/tailor-platform/sdk/commit/bfe4872211d5ac7f3ceb610d5ca53160add3d918) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint-tsgolint to v0.11.1

- [#439](https://github.com/tailor-platform/sdk/pull/439) [`81b086f`](https://github.com/tailor-platform/sdk/commit/81b086fd827fcae7e54e8a53d24d64be62c553a6) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency rolldown to v1.0.0-beta.60

- [#443](https://github.com/tailor-platform/sdk/pull/443) [`21ab273`](https://github.com/tailor-platform/sdk/commit/21ab273abf99e436daccd0355439870663f3fee1) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.458.0

- [#444](https://github.com/tailor-platform/sdk/pull/444) [`85f0b8a`](https://github.com/tailor-platform/sdk/commit/85f0b8a49fdd6e20c36395b85d97c2f8ede3a400) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v5.81.0

- [#404](https://github.com/tailor-platform/sdk/pull/404) [`0c48431`](https://github.com/tailor-platform/sdk/commit/0c4843100dbd49a5ef3e84e03dc09a890b8c0405) Thanks [@riku99](https://github.com/riku99)! - Enable deploying and viewing TailorDB ERD static sites via the CLI

## 1.2.6

### Patch Changes

- [#419](https://github.com/tailor-platform/sdk/pull/419) [`e8b3184`](https://github.com/tailor-platform/sdk/commit/e8b31847c043084ee6826471805225fc9e44b156) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support `requireDpop` for auth oauth2 client

## 1.2.5

### Patch Changes

- [#410](https://github.com/tailor-platform/sdk/pull/410) [`2ec1a6e`](https://github.com/tailor-platform/sdk/commit/2ec1a6ef2e4f6f0b588c427aa827b3a15cd22b12) Thanks [@remiposo](https://github.com/remiposo)! - Improve message on refresh token error

  Improved to guide users to run `tailor-sdk login` and try again instead of showing the internal unclear message.

- [#415](https://github.com/tailor-platform/sdk/pull/415) [`0d00604`](https://github.com/tailor-platform/sdk/commit/0d0060476b704dd7d3009d52bb3d2433d322e524) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: add colored output to logger icons and messages

  - Apply colors (cyan, green, yellow, red, gray) based on log type
  - Gate logger.debug() output with DEBUG=true environment variable

- [#408](https://github.com/tailor-platform/sdk/pull/408) [`273873d`](https://github.com/tailor-platform/sdk/commit/273873da1c211055a3d2a9a14de5d247e0d80ac5) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.56.3

- [#409](https://github.com/tailor-platform/sdk/pull/409) [`6c24562`](https://github.com/tailor-platform/sdk/commit/6c2456225cc6e2dcd5d4df54e4fb9831b3a3abfe) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.19.0

- [#416](https://github.com/tailor-platform/sdk/pull/416) [`2a8be27`](https://github.com/tailor-platform/sdk/commit/2a8be270471743d3e937184c02d4af27eb1bb57f) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.7.4

## 1.2.4

### Patch Changes

- [#382](https://github.com/tailor-platform/sdk/pull/382) [`a2d0eb8`](https://github.com/tailor-platform/sdk/commit/a2d0eb86b8e606d59a1735289d7c2c6e74398039) Thanks [@riku99](https://github.com/riku99)! - Enable jsdoc/require-param and jsdoc/require-returns

- [#386](https://github.com/tailor-platform/sdk/pull/386) [`6ff9aee`](https://github.com/tailor-platform/sdk/commit/6ff9aeea68ee391e9aeb78c8081ee0a7a7e04729) Thanks [@riku99](https://github.com/riku99)! - Introduce Knip

- [#380](https://github.com/tailor-platform/sdk/pull/380) [`2718b7a`](https://github.com/tailor-platform/sdk/commit/2718b7abd8a3c2603c8cfbd234ada41bcf4d0061) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency zod to v4.3.5

- [#381](https://github.com/tailor-platform/sdk/pull/381) [`dddd908`](https://github.com/tailor-platform/sdk/commit/dddd908fce87f0dc46a96480136f847ae67a7f31) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260104.1

- [#385](https://github.com/tailor-platform/sdk/pull/385) [`1481cbd`](https://github.com/tailor-platform/sdk/commit/1481cbd9c2c2dfda7ee61af45b8d4881716db67e) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.452.0

- [#387](https://github.com/tailor-platform/sdk/pull/387) [`8d415c9`](https://github.com/tailor-platform/sdk/commit/8d415c9813f0bc7f4e9df67206081e9af10991cf) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.7.3

- [#388](https://github.com/tailor-platform/sdk/pull/388) [`c37287c`](https://github.com/tailor-platform/sdk/commit/c37287c254bb08cebc3e97fc96192a864f9f2999) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.52.0

- [#389](https://github.com/tailor-platform/sdk/pull/389) [`866596d`](https://github.com/tailor-platform/sdk/commit/866596d8648c7ada3d549c9ea68ec59c3960ba7d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.56.2

- [#391](https://github.com/tailor-platform/sdk/pull/391) [`b6186e0`](https://github.com/tailor-platform/sdk/commit/b6186e07f8bf8b1f78b827a871d28b6ac97b1967) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260106.1

- [#393](https://github.com/tailor-platform/sdk/pull/393) [`737518e`](https://github.com/tailor-platform/sdk/commit/737518e99bfbce7c3237e7344910a1510f4c16ea) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.453.0

- [#394](https://github.com/tailor-platform/sdk/pull/394) [`b70bdea`](https://github.com/tailor-platform/sdk/commit/b70bdeacdfcef6e042311592bd37ae79bb1f7372) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v5.80.0

- [#399](https://github.com/tailor-platform/sdk/pull/399) [`ec073a1`](https://github.com/tailor-platform/sdk/commit/ec073a1346066b195459976e16579adc6fef1173) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.454.0

- [#401](https://github.com/tailor-platform/sdk/pull/401) [`5744ef5`](https://github.com/tailor-platform/sdk/commit/5744ef5a6b1930e8d98aeaa92a189c5e49c21581) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update suzuki-shunsuke/commit-action action to v0.1.0

- [#402](https://github.com/tailor-platform/sdk/pull/402) [`e8e7105`](https://github.com/tailor-platform/sdk/commit/e8e7105c8553f9f258f602923e976b1455e06343) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency oxlint-tsgolint to v0.11.0

- [#406](https://github.com/tailor-platform/sdk/pull/406) [`5377f2a`](https://github.com/tailor-platform/sdk/commit/5377f2a7bca9d4090f44c502b49d82f3e253b536) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency knip to v5.80.2

- [#411](https://github.com/tailor-platform/sdk/pull/411) [`634b81d`](https://github.com/tailor-platform/sdk/commit/634b81d3beb9ced4d16b695c2c945a1af667694a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency eslint-plugin-jsdoc to v62

- [#407](https://github.com/tailor-platform/sdk/pull/407) [`49cefda`](https://github.com/tailor-platform/sdk/commit/49cefda3d868a66122a02a5e011f5b5379f37035) Thanks [@remiposo](https://github.com/remiposo)! - Made it possible to change the OAuth2 Client ID

  By setting PLATFORM_OAUTH2_CLIENT_ID, you can now change the OAuth2 Client ID used for logging into Tailor Platform. Using it in combination with PLATFORM_URL makes it easier to log into non-production Tailor Platform environments for testing. This is for internal debugging purposes and is not intended to be set by regular users.

## 1.2.3

### Patch Changes

- [#378](https://github.com/tailor-platform/sdk/pull/378) [`20471c1`](https://github.com/tailor-platform/sdk/commit/20471c180df682a2b9ba6382039611b689ccb8e3) Thanks [@riku99](https://github.com/riku99)! - Enable the jsdoc/require-jsdoc rule

- [#362](https://github.com/tailor-platform/sdk/pull/362) [`e500267`](https://github.com/tailor-platform/sdk/commit/e5002677aded90ec8a4ab7113eb074dc537d456a) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor: move relation logic from configure layer to parser layer

## 1.2.2

### Patch Changes

- [#369](https://github.com/tailor-platform/sdk/pull/369) [`202e5a7`](https://github.com/tailor-platform/sdk/commit/202e5a7f5c170de18d98255ca798d19552d2905d) Thanks [@toiroakr](https://github.com/toiroakr)! - Prevent index/unique settings on array fields with type-level constraints and runtime validation

- [#371](https://github.com/tailor-platform/sdk/pull/371) [`1c5f2a8`](https://github.com/tailor-platform/sdk/commit/1c5f2a897ef0b346a8de9cb71c7359e09724ac00) Thanks [@riku99](https://github.com/riku99)! - Enable selected JSDoc-related lint rules

- [#370](https://github.com/tailor-platform/sdk/pull/370) [`78d4667`](https://github.com/tailor-platform/sdk/commit/78d4667b7f8fc649dd1d1fe8e0aa70bf8c456be9) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.63.0

- [#374](https://github.com/tailor-platform/sdk/pull/374) [`8c4bff8`](https://github.com/tailor-platform/sdk/commit/8c4bff8db7dedba16ab6572473d7b93cf9ac2211) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): pin dependency oxlint-tsgolint to 0.10.1

- [#375](https://github.com/tailor-platform/sdk/pull/375) [`f42a755`](https://github.com/tailor-platform/sdk/commit/f42a7556785bf97f6aedb3dc03d398f0d38c492d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @typescript/native-preview to v7.0.0-dev.20260103.1

- [#367](https://github.com/tailor-platform/sdk/pull/367) [`2edef96`](https://github.com/tailor-platform/sdk/commit/2edef96db3b1a6ed88e5fb1f64dab4e2d0dd7867) Thanks [@riku99](https://github.com/riku99)! - Use tsgo and tsgolint in packages/sdk and example

## 1.2.1

### Patch Changes

- [#353](https://github.com/tailor-platform/sdk/pull/353) [`2f5e2bf`](https://github.com/tailor-platform/sdk/commit/2f5e2bf80174e48c6e7ffd4e057d740a88b178e7) Thanks [@riku99](https://github.com/riku99)! - Use oxlint and oxfmt in example and create-sdk/templates

- [#363](https://github.com/tailor-platform/sdk/pull/363) [`71fdaa9`](https://github.com/tailor-platform/sdk/commit/71fdaa97ae80db62e1bd4778721baee849f0412f) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: remove rolldown override (upstream issues resolved)

- [#358](https://github.com/tailor-platform/sdk/pull/358) [`90618d1`](https://github.com/tailor-platform/sdk/commit/90618d10bd543ddbe57ace65b80c007247865737) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency zod to v4.3.4

## 1.2.0

### Minor Changes

- [#343](https://github.com/tailor-platform/sdk/pull/343) [`7264ef6`](https://github.com/tailor-platform/sdk/commit/7264ef6a1fbbb53c69aacccb2e50d500ab0e61c8) Thanks [@toiroakr](https://github.com/toiroakr)! - Add typed fields to `resolverExecutedTrigger` and `env` support for all executor args
  - Add `success`, `result`, `error` fields to `ResolverExecutedArgs` with tagged union type
  - Add `env: TailorEnv` to all trigger Args types and operation args

### Patch Changes

- [#342](https://github.com/tailor-platform/sdk/pull/342) [`ec710be`](https://github.com/tailor-platform/sdk/commit/ec710be1aa2ff6f9b8f5d6816010340a95b6835e) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(cli): unify table border style to single-line across all CLI commands

  - Add `formatTable`, `formatKeyValueTable`, `formatTableWithHeaders` utility functions
  - Add `formatValue` function for proper object/array formatting in tables
  - Add ESLint rule to restrict direct `table` import
  - Add tests for format utilities

- [#346](https://github.com/tailor-platform/sdk/pull/346) [`a8355bb`](https://github.com/tailor-platform/sdk/commit/a8355bb9aafbf6ea1da5167939cc429b4010462a) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor(cli): improve stdout/stderr separation following clig.dev guidelines

  - Add custom reporters (`IconReporter`, `PlainReporter`) to prevent extra newlines in piped environments
  - All log methods (`info`, `success`, `warn`, `error`, `log`, `debug`) now output to stderr
  - Rename `logger.data()` to `logger.out()` for primary program output to stdout
  - `logger.out()` now accepts strings in addition to objects for table output

  This separation allows clean command composition where stdout carries data output and stderr handles all messaging.

- [#345](https://github.com/tailor-platform/sdk/pull/345) [`f92d582`](https://github.com/tailor-platform/sdk/commit/f92d582c6b4c23163ba6d750251f7ed4fad4677b) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: e2e tests incorrectly counting resources when multiple apps exist in workspace

  Fixed an issue where e2e tests counted resources from other applications in the same workspace.

  - Add metadata filtering by `sdk-name` label in e2e tests
  - Set metadata on JobFunctions during apply and remove when no longer used

- [#355](https://github.com/tailor-platform/sdk/pull/355) [`c41a004`](https://github.com/tailor-platform/sdk/commit/c41a0044652f2c28d64ccd1f5af5a6db7a0450b8) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.451.1

- [#357](https://github.com/tailor-platform/sdk/pull/357) [`7bf2782`](https://github.com/tailor-platform/sdk/commit/7bf2782db414ba22e5e756fe7c72f4507815924c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm to v10.27.0

## 1.1.3

### Patch Changes

- [#331](https://github.com/tailor-platform/sdk/pull/331) [`a427322`](https://github.com/tailor-platform/sdk/commit/a427322a2f9cf191079ce5dca5264603b32cec65) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: use POSIX path separators in seed generator for Windows compatibility

  The seed generator now uses forward slashes for import paths on all platforms, ensuring consistent output between Windows and Unix systems.

- [#332](https://github.com/tailor-platform/sdk/pull/332) [`660e688`](https://github.com/tailor-platform/sdk/commit/660e688ccd4e5e680a309b45c45781acf61c4022) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua to v2.56.1

- [#333](https://github.com/tailor-platform/sdk/pull/333) [`820e925`](https://github.com/tailor-platform/sdk/commit/820e925c10a4071c00096639e767655652e253af) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.448.1

- [#335](https://github.com/tailor-platform/sdk/pull/335) [`abcd50d`](https://github.com/tailor-platform/sdk/commit/abcd50d2e8b148280fdd4cd7f014ff0a3df2899b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.18.3

- [#337](https://github.com/tailor-platform/sdk/pull/337) [`37980eb`](https://github.com/tailor-platform/sdk/commit/37980ebe3d8fd69f6d436e346124f58c3d237e52) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency lefthook to v2.0.13

- [#338](https://github.com/tailor-platform/sdk/pull/338) [`53e405c`](https://github.com/tailor-platform/sdk/commit/53e405c1ddea520ca7d54574418267a322d43602) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency turbo to v2.7.2

- [#339](https://github.com/tailor-platform/sdk/pull/339) [`f9be44c`](https://github.com/tailor-platform/sdk/commit/f9be44c5b06b4087d2ebaa55ad27499e77cf9e2c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update pnpm to v10.26.2

- [#340](https://github.com/tailor-platform/sdk/pull/340) [`2eacdb7`](https://github.com/tailor-platform/sdk/commit/2eacdb7178a6631ed44e8cfbae26ddd3835eb95d) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.449.0

- [#341](https://github.com/tailor-platform/sdk/pull/341) [`721fabc`](https://github.com/tailor-platform/sdk/commit/721fabc17bbd38daf6d40e6ad7410f03c63065cd) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency bufbuild/buf to v1.62.1

- [#344](https://github.com/tailor-platform/sdk/pull/344) [`fca3b66`](https://github.com/tailor-platform/sdk/commit/fca3b668af49de5f2358f48c5dca506ecb1efd80) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency rhysd/actionlint to v1.7.10

- [#347](https://github.com/tailor-platform/sdk/pull/347) [`a0c9d9a`](https://github.com/tailor-platform/sdk/commit/a0c9d9a2b7a903c0b216bbf150d5a7cb22186768) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency @jackchuka/gql-ingest to v2.2.2

- [#348](https://github.com/tailor-platform/sdk/pull/348) [`2bf5a50`](https://github.com/tailor-platform/sdk/commit/2bf5a5042915363cf79853df284912f5b87faeea) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency oxc-parser to v0.106.0

- [#349](https://github.com/tailor-platform/sdk/pull/349) [`06b12ca`](https://github.com/tailor-platform/sdk/commit/06b12ca350745e34456fef5e7a77f3790db80880) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.51.0

- [#350](https://github.com/tailor-platform/sdk/pull/350) [`3234867`](https://github.com/tailor-platform/sdk/commit/32348670b86f19f3bf66398e5c6f373230ac4130) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.18.4

## 1.1.2

### Patch Changes

- [#289](https://github.com/tailor-platform/sdk/pull/289) [`c6f655e`](https://github.com/tailor-platform/sdk/commit/c6f655ecd9ae4641bf98233e64f12954410ebcc4) Thanks [@riku99](https://github.com/riku99)! - Introduce oxlint/oxfmt as primary lint/format tools

- [#326](https://github.com/tailor-platform/sdk/pull/326) [`6a61ab8`](https://github.com/tailor-platform/sdk/commit/6a61ab8be5b023e5d890526b3ad897809c43a67f) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency typescript-eslint to v8.50.1

- [#327](https://github.com/tailor-platform/sdk/pull/327) [`480ae46`](https://github.com/tailor-platform/sdk/commit/480ae46b88d4919132f0ea60140460e3602c52ab) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.448.0

- [#328](https://github.com/tailor-platform/sdk/pull/328) [`c3ab92e`](https://github.com/tailor-platform/sdk/commit/c3ab92ef1ca57647a47ce0c9be00d8d0c6e358bd) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update oxlint monorepo

- [#325](https://github.com/tailor-platform/sdk/pull/325) [`fbc29a6`](https://github.com/tailor-platform/sdk/commit/fbc29a645ba5c37c35e298cffb7377aab50233c0) Thanks [@toiroakr](https://github.com/toiroakr)! - chore(docs): add workflow execution to executor

## 1.1.1

### Patch Changes

- [#322](https://github.com/tailor-platform/sdk/pull/322) [`5d1805b`](https://github.com/tailor-platform/sdk/commit/5d1805b1c920285fa5e79f03e6604b898002c355) Thanks [@toiroakr](https://github.com/toiroakr)! - Handle empty resolver/executor/workflow bundles without error and add tests

## 1.1.0

### Minor Changes

- [#314](https://github.com/tailor-platform/sdk/pull/314) [`a073fb9`](https://github.com/tailor-platform/sdk/commit/a073fb92837a3bbe053ce2571c557f9084756c04) Thanks [@toiroakr](https://github.com/toiroakr)! - Add dependencies-based execution order for generators
  - Generators now declare their dependencies (`tailordb`, `resolver`, `executor`)
  - Execution order is phased: TailorDB → Auth → TailorDB-only generators → Resolver → non-executor generators → Executor → executor-dependent generators
  - This allows generated files to be imported by Resolvers and Executors
  - Added utility types for aggregate input: `TailorDBInput`, `ResolverInput`, `ExecutorInput`, `FullInput`, `AggregateArgs`
  - Fixed console output formatting with proper blank line placement

### Patch Changes

- [#317](https://github.com/tailor-platform/sdk/pull/317) [`5af7004`](https://github.com/tailor-platform/sdk/commit/5af700468d48c18b31c3c1d6e7c45d25f9d51962) Thanks [@riku99](https://github.com/riku99)! - Break CLI apply/bundler dependency cycle by extracting enableInlineSourcemap into a shared bundler utility

- [#321](https://github.com/tailor-platform/sdk/pull/321) [`be23262`](https://github.com/tailor-platform/sdk/commit/be23262e0cb09078137d648ee4b6f8d2131e291e) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: use type import in kysely generator template

- [#312](https://github.com/tailor-platform/sdk/pull/312) [`514ca72`](https://github.com/tailor-platform/sdk/commit/514ca7231d2a7d0c37066af0b562ec03a63488fc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency rolldown to v1.0.0-beta.56

- [#319](https://github.com/tailor-platform/sdk/pull/319) [`33d0849`](https://github.com/tailor-platform/sdk/commit/33d08492062bad5622aa0a83214641fd725fbe73) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update actions/download-artifact action to v7

## 1.0.0

### Major Changes

- [#310](https://github.com/tailor-platform/sdk/pull/310) [`07f8f43`](https://github.com/tailor-platform/sdk/commit/07f8f43427a61f4aa8cdf45ebfa5380751ca34d5) Thanks [@toiroakr](https://github.com/toiroakr)! - v1 release 🎉

## 0.24.0

### Minor Changes

- [#308](https://github.com/tailor-platform/sdk/pull/308) [`2880dc6`](https://github.com/tailor-platform/sdk/commit/2880dc6ebb6f94dad080c14b9c006e1c7c9abe9a) Thanks [@IzumiSy](https://github.com/IzumiSy)! - `getDB` function generated by Tailor SDK now supports `KyselyConfig` to let users pass their own customized loggers or Kysely plugins.

  ## Before

  ```ts
  export function getDB<const N extends keyof Namespace>(
    namespace: N
  ): Kysely<Namespace[N]> {
    const client = new tailordb.Client({ namespace });
    return new Kysely<Namespace[N]>({ dialect: new TailordbDialect(client) });
  }
  ```

  ## After

  `kyselyConfig` is added in the second optional argument.

  ```ts
  export function getDB<const N extends keyof Namespace>(
    namespace: N,
    kyselyConfig?: Omit<KyselyConfig, "dialect">
  ): Kysely<Namespace[N]> {
    const client = new tailordb.Client({ namespace });
    return new Kysely<Namespace[N]>({
      dialect: new TailordbDialect(client),
      ...kyselyConfig,
    });
  }
  ```

- [#306](https://github.com/tailor-platform/sdk/pull/306) [`ae5cca3`](https://github.com/tailor-platform/sdk/commit/ae5cca39916acee3a63e2ca8be3903b896176c07) Thanks [@toiroakr](https://github.com/toiroakr)! - Align application config IP allowlist option name with platform/proto.
  - **Breaking**: rename `defineConfig({ allowedIPAddresses })` to `defineConfig({ allowedIpAddresses })`.
  - Update CLI apply mapping and docs/examples accordingly.

### Patch Changes

- [#304](https://github.com/tailor-platform/sdk/pull/304) [`30484dd`](https://github.com/tailor-platform/sdk/commit/30484ddb822bdcd12768ab47b195340d548986aa) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency tsdown to v0.18.2

- [#307](https://github.com/tailor-platform/sdk/pull/307) [`a81d47e`](https://github.com/tailor-platform/sdk/commit/a81d47ed10e2b8d1d04b3ec8ab052c3a13ef562a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependency aquaproj/aqua-registry to v4.447.1

## 0.23.4

### Patch Changes

- [#302](https://github.com/tailor-platform/sdk/pull/302) [`b6f952d`](https://github.com/tailor-platform/sdk/commit/b6f952d86e84af396b80928fdd0fddc897ba00e3) Thanks [@toiroakr](https://github.com/toiroakr)! - Throw an error when backward relation names conflict with other backward relations, existing fields, or files fields

## 0.23.3

### Patch Changes

- [#283](https://github.com/tailor-platform/sdk/pull/283) [`cb117a8`](https://github.com/tailor-platform/sdk/commit/cb117a89ac6ca1ff4db654f1c89a21800714ff5f) Thanks [@riku99](https://github.com/riku99)! - Automatically add a changeset commit to newly opened Renovate PRs

- [#298](https://github.com/tailor-platform/sdk/pull/298) [`cc0f9b4`](https://github.com/tailor-platform/sdk/commit/cc0f9b4c7b1bdb7cefc1336143c0952a7c7c4b44) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update suzuki-shunsuke/commit-action action to v0.0.14

## 0.23.2

### Patch Changes

- [#296](https://github.com/tailor-platform/sdk/pull/296) [`adb9a9d`](https://github.com/tailor-platform/sdk/commit/adb9a9d5d6dad4b961fb8dd448ea2b08d610fc5b) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix service deletion order to prevent "used by gateway(s)" error

  When deleting subgraph services (TailorDB, Pipeline, Auth, IdP), the deletion would fail with an error like "Failed to delete AuthService: auth xxx is used by gateway(s)" because the Application was still referencing them.

  This fix separates the deletion phases:

  - `delete-resources`: Deletes resources (types, resolvers, clients, etc.) before Application update
  - `delete-services`: Deletes services after Application is deleted

  This ensures services are deleted only after the Application no longer references them.

## 0.23.1

### Patch Changes

- [#294](https://github.com/tailor-platform/sdk/pull/294) [`91bafb7`](https://github.com/tailor-platform/sdk/commit/91bafb7d5b8d0c4b2c9fb9f8b9260e33c6213df0) Thanks [@remiposo](https://github.com/remiposo)! - feat: Support optional namespace for userProfile in auth config
  - Auto-resolve namespace when only one TailorDB exists (including external)
  - Allow explicit namespace specification when multiple TailorDBs exist

## 0.23.0

### Minor Changes

- [#286](https://github.com/tailor-platform/sdk/pull/286) [`3409d66`](https://github.com/tailor-platform/sdk/commit/3409d66e6c6944292a3933e055d80c178efa7786) Thanks [@toiroakr](https://github.com/toiroakr)! - Unify CLI option short flags for consistency

  **Breaking Changes:**

  - `apply --dry-run`: Changed short flag from `-n` to `-d`
  - `workspace create --name`: Changed short flag from `-N` to `-n`
  - `workspace create --delete-protection`: Changed short flag from `-D` to `-d`
  - `secret create --name`: Changed short flag from `-N` to `-n`
  - `secret update --name`: Changed short flag from `-N` to `-n`
  - `secret delete --name`: Changed short flag from `-N` to `-n`

  **Documentation:**

  - Updated CLI documentation to reflect the new short flags
  - Added missing `staticwebsite` CLI documentation

  **New Unified Rules:**

  - `--name`: Always uses `-n`
  - `--namespace`: Always uses `-n` (no conflict as it's in different commands)
  - `--dry-run`: Uses `-d` (apply command)
  - `--dir`: Uses `-d` (staticwebsite deploy command)
  - `--delete-protection`: Uses `-d` (workspace create command)

  Note: Short flags can be reused across different commands without conflicts.

## 0.22.4

### Patch Changes

- [#281](https://github.com/tailor-platform/sdk/pull/281) [`f01dc22`](https://github.com/tailor-platform/sdk/commit/f01dc22ddfa477349df6f625286def14649d8694) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: validate plural form duplication

- [#279](https://github.com/tailor-platform/sdk/pull/279) [`a279670`](https://github.com/tailor-platform/sdk/commit/a279670980ae2c843a95a4103ad14f20c3d99213) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor(logger): change warning logs to info level for clarity

- [#284](https://github.com/tailor-platform/sdk/pull/284) [`23e780c`](https://github.com/tailor-platform/sdk/commit/23e780c1a4771ba198e7eb3074f994aa09c94fd2) Thanks [@toiroakr](https://github.com/toiroakr)! - fix(deps): add find-up-simple dependency

## 0.22.3

### Patch Changes

- [#253](https://github.com/tailor-platform/sdk/pull/253) [`a3354b7`](https://github.com/tailor-platform/sdk/commit/a3354b7563ef29333948523c5597a1ad96024726) Thanks [@riku99](https://github.com/riku99)! - Clarify unmanaged resource confirmation message in apply flow

- [#272](https://github.com/tailor-platform/sdk/pull/272) [`4448d64`](https://github.com/tailor-platform/sdk/commit/4448d644ad70ad69b717aec98552399ef345122c) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: update CLI command name

- [#224](https://github.com/tailor-platform/sdk/pull/224) [`db2e72e`](https://github.com/tailor-platform/sdk/commit/db2e72e0070ff51977aa36397181095d077762d1) Thanks [@riku99](https://github.com/riku99)! - Add SDK test coverage reporting to PRs via octocov

## 0.22.2

### Patch Changes

- [#196](https://github.com/tailor-platform/sdk/pull/196) [`23e791f`](https://github.com/tailor-platform/sdk/commit/23e791f0673eaf003059a86a7c493e0e26282f2d) Thanks [@haru0017](https://github.com/haru0017)! - Switch from custom keys/certs to Tailor platform defaults

## 0.22.1

### Patch Changes

- [#248](https://github.com/tailor-platform/sdk/pull/248) [`7263038`](https://github.com/tailor-platform/sdk/commit/7263038d340450146490a6ac9e1af0745963640c) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor: move parseFieldConfig and tailorUserMap to parser layer
  - Move `TailorDBField.get config()` logic to `parseFieldConfig` in parser layer
  - Move `tailorUserMap` constant from configure to parser layer
  - Remove `TailorDBTypeConfig` in favor of `TailorDBTypeMetadata` (without fields)
  - Update ESLint config to allow type imports from configure in parser module
  - Export `DBFieldMetadata` and `Hook` types from tailordb module

## 0.22.0

### Minor Changes

- [#258](https://github.com/tailor-platform/sdk/pull/258) [`14da273`](https://github.com/tailor-platform/sdk/commit/14da273763464f2b1e1ad8f3a45b3211a4a0aece) Thanks [@jackchuka](https://github.com/jackchuka)! - feat: introduce api command

### Patch Changes

- [#226](https://github.com/tailor-platform/sdk/pull/226) [`2d0cb80`](https://github.com/tailor-platform/sdk/commit/2d0cb80f627c2c3ef1e72bda11ad25560f0909dd) Thanks [@haru0017](https://github.com/haru0017)! - feat: enable inline sourcemaps for better debugging

## 0.21.4

### Patch Changes

- [#245](https://github.com/tailor-platform/sdk/pull/245) [`f4d4c8e`](https://github.com/tailor-platform/sdk/commit/f4d4c8e5f0df6161376c4e02af90f76aecb5ec01) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: throw error for prompts in CI environments

  In CI environments, interactive prompts cause the CLI to hang indefinitely. This change detects CI environments using `std-env` and throws a `CIPromptError` when `logger.prompt` is called, instructing users to use the `--yes` flag to skip confirmation prompts.

- [#243](https://github.com/tailor-platform/sdk/pull/243) [`2084c68`](https://github.com/tailor-platform/sdk/commit/2084c68be83fe5693b3df838e5c780d79d7d06fa) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix deletion of resolvers that conflict with system-generated ones

  When a TailorDB type is created (e.g., `User`), the system auto-generates resolvers like `deleteUser`, `createUser`, etc. If a user created a custom resolver with the same name, it could not be deleted because the Application update (SDL composition) failed before the deletion phase.

  This fix reorders the apply phases to delete subgraph services before updating the Application:

  1. Create/Update services that Application depends on (subgraphs + StaticWebsite)
  2. Delete subgraph services (before Application update to avoid SDL conflicts)
  3. Create/Update Application
  4. Create/Update services that depend on Application (Executor, Workflow)
  5. Delete services that depend on Application, then Application itself

## 0.21.3

### Patch Changes

- [#238](https://github.com/tailor-platform/sdk/pull/238) [`36639c6`](https://github.com/tailor-platform/sdk/commit/36639c6e1efee873eff89e61c59c60b8b22531a8) Thanks [@toiroakr](https://github.com/toiroakr)! - Improve Connect error messages in CLI

  - Add `errorHandlingInterceptor` to enhance error messages from Connect protocol
  - Error messages now include operation type, resource type, and request parameters
  - Makes it easier to identify which resource caused validation errors

  Before:

  ```
  ERROR  [invalid_argument] validation error: namespace_name: value does not match regex pattern...
  ```

  After:

  ```
  ERROR  [invalid_argument] Failed to list TailorDBTypes: validation error: namespace_name: value does not match regex pattern...
  Request: {
    "namespaceName": "db",
    ...
  }
  ```

## 0.21.2

## 0.21.1

### Patch Changes

- [#233](https://github.com/tailor-platform/sdk/pull/233) [`475d368`](https://github.com/tailor-platform/sdk/commit/475d36848c35530cc302b82f365af4d4f84cb9a3) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove setup-node from install-deps action and use standalone pnpm with pnpm env for Node.js installation

## 0.21.0

### Minor Changes

- [#228](https://github.com/tailor-platform/sdk/pull/228) [`5b7749e`](https://github.com/tailor-platform/sdk/commit/5b7749e996f849bac158678cec0d63c710bfef2e) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(cli)!: enhance command arguments and improve documentation for secret and workflow commands

### Patch Changes

- [#225](https://github.com/tailor-platform/sdk/pull/225) [`21f689d`](https://github.com/tailor-platform/sdk/commit/21f689df8f53e2731a36b50e14faa43f09d5a4e2) Thanks [@riku99](https://github.com/riku99)! - Refactor example resolvers to call getDB() inside handlers instead of importing a shared DB instance

- [#229](https://github.com/tailor-platform/sdk/pull/229) [`70527bb`](https://github.com/tailor-platform/sdk/commit/70527bb1c2bb1e0d2f03d94a539c771f6e3f54d3) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: load organization/folder from env

## 0.20.0

### Minor Changes

- [#220](https://github.com/tailor-platform/sdk/pull/220) [`f4b3d4e`](https://github.com/tailor-platform/sdk/commit/f4b3d4e237e08982e185db980a6b5666fb89cb5a) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor(cli)!: rename "user use" to "user switch"

## 0.19.0

### Minor Changes

- [#213](https://github.com/tailor-platform/sdk/pull/213) [`09b7a9b`](https://github.com/tailor-platform/sdk/commit/09b7a9b160d5263215c24ba1846ca084bd915323) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor(cli)!: unify logger/styles

### Patch Changes

- [#214](https://github.com/tailor-platform/sdk/pull/214) [`45f07e0`](https://github.com/tailor-platform/sdk/commit/45f07e0f96192e530c1a7230efcf494c0e92fb13) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support password policy fields for IdP userAuthPolicy

- [#215](https://github.com/tailor-platform/sdk/pull/215) [`63fe144`](https://github.com/tailor-platform/sdk/commit/63fe144eef6e40ef03cbb6414f08de011cd47014) Thanks [@riku99](https://github.com/riku99)! - Add test to ensure CLI subcommands do not define duplicate short option aliases

## 0.18.2

### Patch Changes

- [#210](https://github.com/tailor-platform/sdk/pull/210) [`ba0a0cc`](https://github.com/tailor-platform/sdk/commit/ba0a0cc46c5cda564a09d95e32663315818bb4c8) Thanks [@remiposo](https://github.com/remiposo)! - fix: Load workspaceID from env for staticwebsite deploy

## 0.18.1

### Patch Changes

- [#174](https://github.com/tailor-platform/sdk/pull/174) [`67483e1`](https://github.com/tailor-platform/sdk/commit/67483e19128b19bb26eea3a99e7f23f304255f14) Thanks [@riku99](https://github.com/riku99)! - Add staticwebsite deploy command to the tailor-sdk CLI for static web hosting

  Add staticwebsite get command to inspect static website details (name, URL, allowed IP addresses, etc.) from the CLI.

  Add staticwebsite list command to list static websites (including workspace ID, URL, and allowed IP address count) from the CLI.

## 0.18.0

### Minor Changes

- [#198](https://github.com/tailor-platform/sdk/pull/198) [`7f06c62`](https://github.com/tailor-platform/sdk/commit/7f06c620a2b3baf551dcbd39418fcb0675661463) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor!: rename entityAction to actionEntity

### Patch Changes

- [#203](https://github.com/tailor-platform/sdk/pull/203) [`f3c559e`](https://github.com/tailor-platform/sdk/commit/f3c559e426572431db25f4b71af414650dc6e9a4) Thanks [@remiposo](https://github.com/remiposo)! - Fix Kysely type generation for enum array fields to wrap union types in parentheses

- [#192](https://github.com/tailor-platform/sdk/pull/192) [`d2ce834`](https://github.com/tailor-platform/sdk/commit/d2ce8345fb839f6086f4286c27373dfa3336734c) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support `accessTokenLifetimeSeconds` and `refreshTokenLifetimeSeconds` for auth oauth2 client

## 0.17.0

### Minor Changes

- [#158](https://github.com/tailor-platform/sdk/pull/158) [`cde0a0a`](https://github.com/tailor-platform/sdk/commit/cde0a0a3e1d517e8036f799ce2a0b8958f7e18c4) Thanks [@riku99](https://github.com/riku99)! - CLI changes:

  - Replace `--format` with `--json` for all list/detail commands. `--format` is no longer supported.
  - Change default table layout for list output and humanize `createdAt` / `updatedAt` in table format (JSON remains ISO strings).
  - `workspace list`: hide `updatedAt` in table output and add `--limit=<number>` to cap the number of workspaces shown.

  **Breaking:** Scripts or tooling that relied on `--format` or the previous table layout may need to be updated.

### Patch Changes

- [#197](https://github.com/tailor-platform/sdk/pull/197) [`6c141f0`](https://github.com/tailor-platform/sdk/commit/6c141f0cf23d360f531dec2a39330b3fa755f7e1) Thanks [@toiroakr](https://github.com/toiroakr)! - Fix `tailordb truncate` command argument parsing: `-n` alias now works correctly and multiple type names can be specified as space-separated arguments

- [#191](https://github.com/tailor-platform/sdk/pull/191) [`92f0e99`](https://github.com/tailor-platform/sdk/commit/92f0e99f0bbcdd4616b56157cd2b67a71757fb05) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: createTailorDBHook for Date

## 0.16.3

### Patch Changes

- [#179](https://github.com/tailor-platform/sdk/pull/179) [`2108408`](https://github.com/tailor-platform/sdk/commit/2108408cc9e2befc93e0e0db8ab91ca0c6036222) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support `userAuthPolicy` for idp

## 0.16.2

### Patch Changes

- [#170](https://github.com/tailor-platform/sdk/pull/170) [`6c34448`](https://github.com/tailor-platform/sdk/commit/6c344484cc9f4b0a574ec09737ca4e30e3889ad2) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add workflow executor support

  Added `kind: "workflow"` operation to executors, enabling direct workflow execution from schedule triggers or record triggers.

  ```typescript
  import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
  import sampleWorkflow from "../workflows/sample";

  export default createExecutor({
    name: "daily-workflow",
    trigger: scheduleTrigger({
      cron: "0 12 * * *",
      timezone: "Asia/Tokyo",
    }),
    operation: {
      kind: "workflow",
      workflow: sampleWorkflow,
      args: () => ({ orderId: "daily-workflow-order" }),
    },
  });
  ```

  - `workflow`: The workflow to execute (default export)
  - `args`: Arguments to pass to the workflow's mainJob (static value or function)
  - `authInvoker`: Optional authentication configuration

## 0.16.1

### Patch Changes

- [#160](https://github.com/tailor-platform/sdk/pull/160) [`1406523`](https://github.com/tailor-platform/sdk/commit/14065237e5f0b05cf898c0fff196e1eb599fb96f) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: correctly determine create/update for workflow job functions

  Previously, the SDK used `hasExistingWorkflows` (based on workflow updates) to decide whether to use `createWorkflowJobFunction` or `updateWorkflowJobFunction`. This caused errors when renaming job functions, as renamed jobs were incorrectly sent to the update API which requires the job to already exist.

  Now the SDK fetches the actual list of existing job function names via `listWorkflowJobFunctions` API and correctly uses:

  - `createWorkflowJobFunction` for new job names (including renamed jobs)
  - `updateWorkflowJobFunction` for existing job names

## 0.16.0

### Minor Changes

- [#157](https://github.com/tailor-platform/sdk/pull/157) [`0677519`](https://github.com/tailor-platform/sdk/commit/06775196274dc451b60e675a2859160e2a98eae1) Thanks [@toiroakr](https://github.com/toiroakr)! - fix!: rename body to requestBody in webhook executor

## 0.15.1

### Patch Changes

- [#155](https://github.com/tailor-platform/sdk/pull/155) [`a65171a`](https://github.com/tailor-platform/sdk/commit/a65171af65109c08023a6b1a42683645c4e2675e) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add type constraints to workflow job body functions
  - Input type: Must be JSON-compatible (no Date/toJSON objects). Interfaces are now supported.
  - Output type: Allows Jsonifiable values (including Date with toJSON), undefined, and void
  - Trigger return type: Returns `Jsonify<Output>` - Date becomes string after JSON serialization
  - Added `JsonCompatible<T>` helper type to support TypeScript interfaces as input types
  - TailorDB timestamp fields now return `Date` objects instead of ISO strings

## 0.15.0

### Minor Changes

- [#145](https://github.com/tailor-platform/sdk/pull/145) [`8e4de4e`](https://github.com/tailor-platform/sdk/commit/8e4de4efa4e46117869ad32082cc5b54be2250f8) Thanks [@riku99](https://github.com/riku99)! - feat!: Change db/t enum arguments from variadic to array

## 0.14.3

### Patch Changes

- [#149](https://github.com/tailor-platform/sdk/pull/149) [`eb904c7`](https://github.com/tailor-platform/sdk/commit/eb904c7f81f2ed29f1bb5e82b05ec9f90e974a4d) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: remove globalThis.main

## 0.14.2

### Patch Changes

- [#146](https://github.com/tailor-platform/sdk/pull/146) [`0197d09`](https://github.com/tailor-platform/sdk/commit/0197d09cd9bd65d3d6981d99a58b352e0cf43754) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: workflow bundle bug

- [#147](https://github.com/tailor-platform/sdk/pull/147) [`2d2feed`](https://github.com/tailor-platform/sdk/commit/2d2feedce031bdf321707506a597a98ae863236d) Thanks [@toiroakr](https://github.com/toiroakr)! - feat(cli): add workflow command

- [#129](https://github.com/tailor-platform/sdk/pull/129) [`b8a2fa0`](https://github.com/tailor-platform/sdk/commit/b8a2fa098016b2e053afdb3b517114d46369657f) Thanks [@riku99](https://github.com/riku99)! - Add a lint-based guard for TailorDB field hooks/validate scripts that detects references to non-local variables/functions and fails apply when such external dependencies are present.

## 0.14.1

### Patch Changes

- [#130](https://github.com/tailor-platform/sdk/pull/130) [`78a2332`](https://github.com/tailor-platform/sdk/commit/78a2332162cf05a4c88e88556b65a1b6aebb12c2) Thanks [@riku99](https://github.com/riku99)! - Added unsafe "allow all" TailorDB permissions

- [#138](https://github.com/tailor-platform/sdk/pull/138) [`762dffd`](https://github.com/tailor-platform/sdk/commit/762dffd3c1fc9a7ec9709ba4655d531e4f6f24ce) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: enhance workflow job bundling and dependency tracking

- [#132](https://github.com/tailor-platform/sdk/pull/132) [`c87ee91`](https://github.com/tailor-platform/sdk/commit/c87ee9171797c1d6048cdab80cbbcd491e6dd0f3) Thanks [@riku99](https://github.com/riku99)! - Fix TailorDB hooks script generation to support method-style functions

## 0.14.0

### Minor Changes

- [#124](https://github.com/tailor-platform/sdk/pull/124) [`6d96fdb`](https://github.com/tailor-platform/sdk/commit/6d96fdbbecc225e9906b9c0b2225a733dd8fc4d8) Thanks [@toiroakr](https://github.com/toiroakr)! - Add workflow trigger functionality

  - Add `trigger` method to `Workflow` type that allows triggering workflows from resolvers and executors
  - Support `authInvoker` option for authentication when triggering workflows

  **Breaking Changes**

  - AuthInvoker field names changed:
    - `authName` → `namespace`
    - `machineUser` → `machineUserName`
    - This affects both `auth.invoker()` return value and direct object usage in executor's `authInvoker` option
  - Executor operation field renamed:
    - `invoker` → `authInvoker`
  - SecretValue field names changed:
    - `VaultName` → `vaultName`
    - `SecretKey` → `secretKey`

## 0.13.0

### Minor Changes

- [#121](https://github.com/tailor-platform/sdk/pull/121) [`bc7a3e9`](https://github.com/tailor-platform/sdk/commit/bc7a3e96b4805e75fcb153220d286abaced26368) Thanks [@toiroakr](https://github.com/toiroakr)! - Streamline workflow job function registration and trigger handling

  **Breaking Changes:**

  - Removed `deps` property from `createWorkflowJob()` - jobs no longer declare dependencies explicitly
  - Removed `jobs` object from `WorkflowJobContext` - use `.trigger()` method instead
  - Changed the way workflow jobs call other jobs: from `jobs.job_name()` to `otherJob.trigger()`

  **Migration Guide:**

  Before:

  ```typescript
  export const fetchCustomer = createWorkflowJob({
    name: "fetch-customer",
    body: async (input: { customerId: string }) => {
      // fetch logic
    },
  });

  export const processOrder = createWorkflowJob({
    name: "process-order",
    deps: [fetchCustomer],
    body: async (input, { jobs }) => {
      const customer = await jobs.fetch_customer({
        customerId: input.customerId,
      });
      return { customer };
    },
  });
  ```

  After:

  ```typescript
  export const fetchCustomer = createWorkflowJob({
    name: "fetch-customer",
    body: async (input: { customerId: string }) => {
      // fetch logic
    },
  });

  export const processOrder = createWorkflowJob({
    name: "process-order",
    body: async (input, { env }) => {
      const customer = await fetchCustomer.trigger({
        customerId: input.customerId,
      });
      return { customer };
    },
  });
  ```

  **Key Changes:**

  - Dependencies are now automatically detected via AST analysis of `.trigger()` calls at bundle time
  - The `.trigger()` method is transformed to `tailor.workflow.triggerJobFunction()` during bundling
  - Job function registration is optimized - all job functions are registered once and shared across workflows
  - Unused jobs (not reachable from any mainJob via trigger calls) are automatically excluded from bundles

### Patch Changes

- [#102](https://github.com/tailor-platform/sdk/pull/102) [`ac99d85`](https://github.com/tailor-platform/sdk/commit/ac99d8506693e27512a3ff59c5c8e4fda63b4695) Thanks [@riku99](https://github.com/riku99)! - Add CLI commands for managing Secret Manager vaults and secrets

## 0.12.4

### Patch Changes

- [#107](https://github.com/tailor-platform/sdk/pull/107) [`66fd5b5`](https://github.com/tailor-platform/sdk/commit/66fd5b5e507c6fd7f802e25819ec1e9896b43d80) Thanks [@remiposo](https://github.com/remiposo)! - Manage workflow resources with labels

  Added labels to workflow resources just like other resources. This is a small breaking change for users already using workflows (a confirmation will occur), but since workflow itself is still a preview feature, we believe this is acceptable.

- [#109](https://github.com/tailor-platform/sdk/pull/109) [`2223025`](https://github.com/tailor-platform/sdk/commit/22230255d463ce76c709f8c441c9ca16e581b6e3) Thanks [@k1LoW](https://github.com/k1LoW)! - feat: support `lang` for idp

- [#110](https://github.com/tailor-platform/sdk/pull/110) [`5de725c`](https://github.com/tailor-platform/sdk/commit/5de725ce459788ead266930338c922ebd59123ed) Thanks [@remiposo](https://github.com/remiposo)! - Removed unused referenced field

## 0.12.3

## 0.12.2

### Patch Changes

- [#99](https://github.com/tailor-platform/sdk/pull/99) [`f3f2f5a`](https://github.com/tailor-platform/sdk/commit/f3f2f5aeb30dd69477d49e1e2bb78cd237eafe7b) Thanks [@remiposo](https://github.com/remiposo)! - Allow setting self relationship with keyOnly

  Fixed an issue where apply failed with the following configuration:

  ```typescript
  db.type("Node", {
    childId: db.uuid().relation({
      type: "keyOnly",
      toward: { type: "self" },
    }),
  });
  ```

## 0.12.1

### Patch Changes

- [#94](https://github.com/tailor-platform/sdk/pull/94) [`7262efa`](https://github.com/tailor-platform/sdk/commit/7262efa4a4783e10003b0b46208e7ae22043cdc9) Thanks [@remiposo](https://github.com/remiposo)! - Added oauth2client commands

  Added commands to retrieve OAuth2 client credentials (clientId and clientSecret) after deployment.
  For security, clientSecret is only shown in the `get` command.

  ```sh
  tailor-sdk oauth2client list
  tailor-sdk oauth2client get <name>
  ```

- [#95](https://github.com/tailor-platform/sdk/pull/95) [`e394176`](https://github.com/tailor-platform/sdk/commit/e3941762da3a5aca68ab63f214c32c4f6fd6a582) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: improve user-defined types

## 0.12.0

### Minor Changes

- [#86](https://github.com/tailor-platform/sdk/pull/86) [`20a816e`](https://github.com/tailor-platform/sdk/commit/20a816e149c1ff14a7f505accf69216da6d5e245) Thanks [@toiroakr](https://github.com/toiroakr)! - Improve seed generator with Windows compatibility and IdP user support
  - Generate `exec.mjs` instead of `exec.sh` for cross-platform compatibility
  - Add IdP user seed generation (`_User` entity) when `BuiltInIdP` is configured
    - Generates `_User.schema.ts`, `_User.graphql`, `_User.json` mapping files
    - Includes foreign key to user profile type and unique index on `name` field
    - Automatically sets dependency order (User → \_User)

### Patch Changes

- [#70](https://github.com/tailor-platform/sdk/pull/70) [`94e2f1c`](https://github.com/tailor-platform/sdk/commit/94e2f1cf9036bd69c6f691c6536841a693afe616) Thanks [@riku99](https://github.com/riku99)! - Simplify generator architecture to single-application model

## 0.11.3

### Patch Changes

- [#75](https://github.com/tailor-platform/sdk/pull/75) [`d05e581`](https://github.com/tailor-platform/sdk/commit/d05e58142c3741c35a731ec1fe770a24d7aa3377) Thanks [@riku99](https://github.com/riku99)! - Fix build script to work on Windows by adding cross-env

## 0.11.2

### Patch Changes

- [#59](https://github.com/tailor-platform/sdk/pull/59) [`c1e926d`](https://github.com/tailor-platform/sdk/commit/c1e926d61c8d2f73b36133f8b8c67f7617455d80) Thanks [@remiposo](https://github.com/remiposo)! - Added the remove command

  Added the remove command to delete all managed resources.

  ```bash
  tailor-sdk remove [options]
  ```

  **Options:**

  - `-w, --workspace-id` - ID of the workspace to remove resources from
  - `-p, --profile` - Workspace profile to use
  - `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
  - `-y, --yes` - Skip confirmation prompt

## 0.11.1

### Patch Changes

- [#55](https://github.com/tailor-platform/sdk/pull/55) [`c61651e`](https://github.com/tailor-platform/sdk/commit/c61651ef0f7bf43f4bae7fe3bd75aac539d0c12f) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Fix unportable type error that `createResolver` raises in bundling.

  Bundling files that export the return values of `createResolver` function has been causing `he inferred type of "X" cannot be named without a reference to "Y". This is likely not portable. A type annotation is necessary.` error. It was caused the return type of `Executor` type that is used internally by `createResolver` function is not exported.

- [#58](https://github.com/tailor-platform/sdk/pull/58) [`e2fc8c0`](https://github.com/tailor-platform/sdk/commit/e2fc8c0d3ce38b6270f319879ec05f1da8f9fb6c) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: remove warning message

## 0.11.0

### Minor Changes

- [#50](https://github.com/tailor-platform/sdk/pull/50) [`7c325c7`](https://github.com/tailor-platform/sdk/commit/7c325c7b6fc1d9d07585a960d1b64994eafb7fc4) Thanks [@toiroakr](https://github.com/toiroakr)! - Add workflow service support
  - Add `createWorkflow()` and `createWorkflowJob()` APIs for orchestrating multiple jobs
  - Support job dependencies via `deps` array with type-safe access (hyphen names converted to underscores)
  - Workflow must be default exported, all jobs must be named exports

### Patch Changes

- [#26](https://github.com/tailor-platform/sdk/pull/26) [`7e6701b`](https://github.com/tailor-platform/sdk/commit/7e6701b9d9c8b3df10d4e4e6788aadd28dd69d42) Thanks [@riku99](https://github.com/riku99)! - Add automated bundle size tracking with octocov

## 0.10.4

### Patch Changes

- [#49](https://github.com/tailor-platform/sdk/pull/49) [`8fef369`](https://github.com/tailor-platform/sdk/commit/8fef369ab65ea34d85aef24a38ac3d0124626a41) Thanks [@remiposo](https://github.com/remiposo)! - Use Controlplane OAuth2 client for login/logout

## 0.10.3

### Patch Changes

- [#40](https://github.com/tailor-platform/sdk/pull/40) [`314543f`](https://github.com/tailor-platform/sdk/commit/314543fc8edeefff944f024a52a89142646329b4) Thanks [@IzumiSy](https://github.com/IzumiSy)! - Export types that `db.type` function uses internally.

  This enables users to bundle Tailor DB type definition as an independent package without using forced type assertion using `any`.

## 0.10.2

### Patch Changes

- [#45](https://github.com/tailor-platform/sdk/pull/45) [`efba21f`](https://github.com/tailor-platform/sdk/commit/efba21f0991a3ee9068684d13407dbdb0b19c425) Thanks [@remiposo](https://github.com/remiposo)! - Callback to localhost on WSL environments

  Adjusted the redirect_uri value to fix an issue where login fails on WSL environments.

## 0.10.1

### Patch Changes

- [#34](https://github.com/tailor-platform/sdk/pull/34) [`ed71900`](https://github.com/tailor-platform/sdk/commit/ed719007420794d50d26eb2a3f1f77c5bb3e60a9) Thanks [@remiposo](https://github.com/remiposo)! - Reference external resources

  You can now add resources managed by Terraform or other SDK projects to your application's subgraph for shared use.
  In this case, the resources themselves are not deployed.

  ```typescript
  defineConfig({
    name: "ref-app",
    db: {
      "shared-db": { external: true },
    },
    resolver: { "shared-resolver": { external: true } },
    auth: { name: "shared-auth", external: true },
    idp: [{ name: "shared-idp", external: true }],
  });
  ```

- [#36](https://github.com/tailor-platform/sdk/pull/36) [`00701da`](https://github.com/tailor-platform/sdk/commit/00701da46ceb9624b58c123fcf0ff19e4dc513f5) Thanks [@remiposo](https://github.com/remiposo)! - Allow specifying the path where types are generated

  By default, types are generated inside `node_modules/@tailor-platform/sdk` based on env and attribute settings, but you can now change the path with `TAILOR_PLATFORM_SDK_TYPE_PATH`.
  This is primarily an option for developers, preventing type definitions from being overridden when working with multiple SDK projects simultaneously.

## 0.10.0

### Minor Changes

- [#25](https://github.com/tailor-platform/sdk/pull/25) [`50069ae`](https://github.com/tailor-platform/sdk/commit/50069aeebeb1c0e09cf66f660367cd26cc565f29) Thanks [@haru0017](https://github.com/haru0017)! - Define environment variables in `defineConfig()` and access them in resolvers and executors via the `env` parameter.

  ```typescript
  export default defineConfig({
    name: "my-app",
    env: { logLevel: "debug", cacheTtl: 3600 },
  });

  // Access in resolver
  body: ({ input, env }) => {
    // env.logLevel, env.cacheTtl available with full type safety
  };
  ```

### Patch Changes

- [#33](https://github.com/tailor-platform/sdk/pull/33) [`1f73bd1`](https://github.com/tailor-platform/sdk/commit/1f73bd1d7abaa0a55358086a0d1b7f7c00cccbf3) Thanks [@remiposo](https://github.com/remiposo)! - Confirm important resource deletion

  Added a confirmation prompt when attempting to delete resources that would result in data loss (tailordb and staticwebsite).
  This can be skipped with the `--yes` flag.

- [#31](https://github.com/tailor-platform/sdk/pull/31) [`5fc5594`](https://github.com/tailor-platform/sdk/commit/5fc5594e0b7b1cdf72dadce505aa58a8ae2e5f4a) Thanks [@remiposo](https://github.com/remiposo)! - Make appName for the Executor's GraphQL target optional

  The default value is its own application name.

## 0.9.0

### Minor Changes

- [#16](https://github.com/tailor-platform/sdk/pull/16) [`7bb9d3a`](https://github.com/tailor-platform/sdk/commit/7bb9d3ae0b1568075867ddf2c2027a636037ee09) Thanks [@remiposo](https://github.com/remiposo)! - Set labels for resource management

  Previously, apply operations targeted all resources in the workspace, so any resources not listed in the config were deleted during apply. This made it practically impossible to create resources managed by Terraform or other SDK applications in the same workspace.

  With this change, resources generated by the SDK are now automatically labeled. By only targeting resources with appropriate labels for deletion, coexistence with resources managed elsewhere is now possible. While this label is currently internal, it should become visible in the console in the future.

  **Breaking Changes:**

  Existing applications are not labeled, so the following warning will appear when you apply for the first time after updating.
  Please confirm or pass the `--yes` flag.

  ```
  WARN  Unmanaged resources detected:

    Resources:
      • TailorDB service "my-db"
      • Auth service "my-auth"
      ...

    These resources are not managed by any application.

  ❯ Add these resources to "my-app"?
  ○ Yes / ● No
  ```

### Patch Changes

- [#16](https://github.com/tailor-platform/sdk/pull/16) [`7bb9d3a`](https://github.com/tailor-platform/sdk/commit/7bb9d3ae0b1568075867ddf2c2027a636037ee09) Thanks [@remiposo](https://github.com/remiposo)! - Load resolver and executor files only once

  By reusing the results when files have already been loaded, file loading logs are no longer displayed multiple times during apply.

## 0.8.6

### Patch Changes

- [#24](https://github.com/tailor-platform/sdk/pull/24) [`ffa71fe`](https://github.com/tailor-platform/sdk/commit/ffa71feba26b36be84292dbaaadc0d2a37dc6b96) Thanks [@riku99](https://github.com/riku99)! - Fix generator bugs with multiple TailorDB namespaces and refactor to object-based data passing

## 0.8.5

### Patch Changes

- [#22](https://github.com/tailor-platform/sdk/pull/22) [`a0bf525`](https://github.com/tailor-platform/sdk/commit/a0bf5259af8a87415d0d731c7995c2612ccc1046) Thanks [@remiposo](https://github.com/remiposo)! - Force excess property checking in defineConfig

## 0.8.4

### Patch Changes

- [#19](https://github.com/tailor-platform/sdk/pull/19) [`58e3486`](https://github.com/tailor-platform/sdk/commit/58e34866f5af9027c05d80f9164ffba8b1d1ff55) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: remove unused Serial type and track utility type usage in Kysely generator

## 0.8.3

### Patch Changes

- [#17](https://github.com/tailor-platform/sdk/pull/17) [`4705799`](https://github.com/tailor-platform/sdk/commit/47057990e183fb9eea132d8802d3d3ec65f07487) Thanks [@remiposo](https://github.com/remiposo)! - Fixed an issue where resolvers returning scalar values didn't work properly

## 0.8.2

### Patch Changes

- [#12](https://github.com/tailor-platform/sdk/pull/12) [`d861a04`](https://github.com/tailor-platform/sdk/commit/d861a0448081566cd7e9ae1ba7eb837f1634c6a9) Thanks [@riku99](https://github.com/riku99)! - Add enum-constants and file-utils built-in generators for type-safe code generation

## 0.8.1

### Patch Changes

- [#11](https://github.com/tailor-platform/sdk/pull/11) [`64436f0`](https://github.com/tailor-platform/sdk/commit/64436f00d936631a239c8229c1c94be4c8230ece) Thanks [@haru0017](https://github.com/haru0017)! - Make `sp_cert_base64` and `sp_key_base64` optional.

## 0.8.0

### Minor Changes

- [#3](https://github.com/tailor-platform/sdk/pull/3) [`b9c3dba`](https://github.com/tailor-platform/sdk/commit/b9c3dbaa4b1df4beb27f5b1da7fe23a83a278637) Thanks [@toiroakr](https://github.com/toiroakr)! - chore!: rename tailor-sdk to sdk

## 0.7.6

### Patch Changes

- [#730](https://github.com/tailor-platform/sdk/pull/730) [`c737903`](https://github.com/tailor-platform/sdk/commit/c73790316fb70924cfe47ea447782648691eb78e) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: generate watch mode

## 0.7.5

### Patch Changes

- [#723](https://github.com/tailor-platform/sdk/pull/723) [`c9233ea`](https://github.com/tailor-platform/sdk/commit/c9233eae05a0c6d09bfb02891f283b278119290c) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add tailordb command with truncate functionality

  see `tailor-sdk tailordb --help`

## 0.7.4

### Patch Changes

- [#721](https://github.com/tailor-platform/sdk/pull/721) [`d83ca38`](https://github.com/tailor-platform/sdk/commit/d83ca38cd9e3f40cbecd342fad6c7d36ece68d5d) Thanks [@remiposo](https://github.com/remiposo)! - Improve Built-in IdP not found error message

## 0.7.3

### Patch Changes

- [#718](https://github.com/tailor-platform/sdk/pull/718) [`857811e`](https://github.com/tailor-platform/sdk/commit/857811e3d57b3b86b45bfe3bb0f9a8b231ff28f5) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add personal access token management commands

  see `tailor-sdk user pat --help`

## 0.7.2

### Patch Changes

- [#716](https://github.com/tailor-platform/sdk/pull/716) [`9e094fa`](https://github.com/tailor-platform/sdk/commit/9e094fa6831837063f4ea62722882c26d31dd256) Thanks [@remiposo](https://github.com/remiposo)! - Apply concurrently

## 0.7.1

### Patch Changes

- [#713](https://github.com/tailor-platform/sdk/pull/713) [`b1c9e3c`](https://github.com/tailor-platform/sdk/commit/b1c9e3c252d1bbc86701255b92877ba3344ba102) Thanks [@remiposo](https://github.com/remiposo)! - Also accept simple objects instead of `t.object()` in resolver output

  Previously, you had to always use `t.object()`, but now you can specify output in the same format as input.

  ```typescript
  // OK
  createResolver({
    output: t.object({
      name: t.string(),
      age: t.int(),
    }),
  });

  // Also OK (same meaning as above)
  createResolver({
    output: {
      name: t.string(),
      age: t.int(),
    },
  });
  ```

## 0.7.0

### Minor Changes

- [#706](https://github.com/tailor-platform/sdk/pull/706) [`6942868`](https://github.com/tailor-platform/sdk/commit/69428681170f6a4a6ec44bdc630be1da456106f0) Thanks [@remiposo](https://github.com/remiposo)! - Changed the interface for `apply` / `generate`

  **Breaking Changes:**

  When calling `apply` / `generate` as functions, specifying `configPath` as the first argument was mandatory, but We've made it optional to align with other commands.

  before:

  ```ts
  import { apply } from "@tailor-platform/sdk/cli";

  // default
  await apply("tailor.config.ts");
  // custom path
  await apply("./path/to/tailor.config.ts");
  ```

  after:

  ```ts
  import { apply } from "@tailor-platform/sdk/cli";

  // default
  await apply();
  // custom path
  await apply({ configPath: "./path/to/tailor.config.ts" });
  ```

## 0.6.2

### Patch Changes

- [#702](https://github.com/tailor-platform/sdk/pull/702) [`6a4f2b1`](https://github.com/tailor-platform/sdk/commit/6a4f2b174cfaec0e0f76380a4f5855d7b275b916) Thanks [@remiposo](https://github.com/remiposo)! - Apply the default value only when ignores is not specified

- [#700](https://github.com/tailor-platform/sdk/pull/700) [`3ab0b98`](https://github.com/tailor-platform/sdk/commit/3ab0b9820fed04d1b19c38c70d938bca79c8ba1b) Thanks [@remiposo](https://github.com/remiposo)! - Exported some commands as functions

  Exported `tailor-sdk workspace create|delete|list` and `tailor-sdk machineuser list|token` as functions. The allowed options are the same except for CLI-specific ones (e.g., `--format`, `--yes`)

  ```typescript
  import { machineUserToken } from "@tailor-platform/sdk/cli";

  const tokens = await machineUserToken({ name: "admin" });
  ```

## 0.6.1

### Patch Changes

- [#698](https://github.com/tailor-platform/sdk/pull/698) [`c781753`](https://github.com/tailor-platform/sdk/commit/c781753971a8b3443bce1e03e9d629ce9667e5fa) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: time regex

## 0.6.0

### Minor Changes

- [#690](https://github.com/tailor-platform/sdk/pull/690) [`790eb46`](https://github.com/tailor-platform/sdk/commit/790eb46d8830c15e4d76610187da5acd74aad172) Thanks [@remiposo](https://github.com/remiposo)! - Deletion and renaming of builtin generators

  **Breaking Changes:**

  Renamed `@tailor/kysely-type` to `@tailor-platform/kysely-type`. Also deleted `@tailor/db-type`.
  If there are any use cases where you're already using `@tailor/db-type` and its deletion would be problematic, please let me know.
  A type error occurs with `defineGenerators()`, so please change the configuration to resolve it.

  before:

  ```typescript
  defineGenerators(
    ["@tailor/kysely-type", { distPath: "./generated/kysely.ts" }],
    ["@tailor/db-type", { distPath: "./generated/db.ts" }]
  );
  ```

  after:

  ```typescript
  defineGenerators([
    "@tailor-platform/kysely-type",
    { distPath: "./generated/kysely.ts" },
  ]);
  ```

## 0.5.6

### Patch Changes

- [#691](https://github.com/tailor-platform/sdk/pull/691) [`4e949b6`](https://github.com/tailor-platform/sdk/commit/4e949b67291ce8775c189a793a99f768ab8904db) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add seed generator

  Added `@tailor-platform/seed` generator that automatically generates seed data files from TailorDB type definitions. This generator creates:

  - GraphQL Ingest mapping files (`mappings/*.json`) and GraphQL files for bulk data loading via [gql-ingest](https://github.com/jackchuka/gql-ingest)
  - lines-db schema files (`data/*.schema.ts`) for validation via [lines-db](https://github.com/toiroakr/lines-db)
  - Configuration file (`config.yaml`) defining entity dependencies

  **Usage:**

  ```typescript
  import { defineGenerators } from "@tailor-platform/sdk";

  export const generators = defineGenerators([
    ["@tailor-platform/seed", { distPath: "./seed" }],
  ]);
  ```

  This will generate seed data infrastructure based on your TailorDB types, enabling validation with [`lines-db`](https://github.com/toiroakr/lines-db) and data ingestion with [`gql-ingest`](https://github.com/jackchuka/gql-ingest).

## 0.5.5

### Patch Changes

- [#686](https://github.com/tailor-platform/sdk/pull/686) [`e8841b6`](https://github.com/tailor-platform/sdk/commit/e8841b654507b67fcd4b0d1919159bd7c0ab217b) Thanks [@remiposo](https://github.com/remiposo)! - Added ignores option

  When specifying files for db, resolver, and executor, we can now exclude specific files with `ignores`. Test-related files (`**/*.test.ts`, `**/*.spec.ts`) are excluded by default.

  ```typescript
  defineConfig({
    db: {
      "my-db": {
        files: ["db/**/*.ts"],
        ignores: ["db/**/*.draft.ts"],
      },
    },
  });
  ```

## 0.5.4

### Patch Changes

- [#682](https://github.com/tailor-platform/sdk/pull/682) [`7678f09`](https://github.com/tailor-platform/sdk/commit/7678f09909e4d604604e8845d39e86be3e7fa47a) Thanks [@remiposo](https://github.com/remiposo)! - Renamed from Tailor SDK to Tailor Platform SDK

## 0.5.3

## 0.5.2

### Patch Changes

- [#675](https://github.com/tailor-platform/sdk/pull/675) [`8cb1c77`](https://github.com/tailor-platform/sdk/commit/8cb1c77582da17f7fa4171ea15fe4d5aa465a9bd) Thanks [@remiposo](https://github.com/remiposo)! - Added testing guides

## 0.5.1

### Patch Changes

- [#672](https://github.com/tailor-platform/sdk/pull/672) [`4730eb1`](https://github.com/tailor-platform/sdk/commit/4730eb1023b6cb3c74483c419242c7a1a4328897) Thanks [@remiposo](https://github.com/remiposo)! - Use `z.custom<Function>` instead of `z.function`

- [#673](https://github.com/tailor-platform/sdk/pull/673) [`7672c9b`](https://github.com/tailor-platform/sdk/commit/7672c9b7866a3a0864bd04cda114b546e07d5051) Thanks [@remiposo](https://github.com/remiposo)! - Exported Namespace of kysely-type

  Exported Namespace to enable retrieving Kysely types like `Selectable<Namespace["main-db"]["User"]>`.

## 0.5.0

### Minor Changes

- [#664](https://github.com/tailor-platform/sdk/pull/664) [`f3e99fb`](https://github.com/tailor-platform/sdk/commit/f3e99fb0b7848fbaaf25c876e44e387e5138fb09) Thanks [@remiposo](https://github.com/remiposo)! - Aligned `createExecutor` interface with `createResolver`

  **Breaking Changes:**

  `createExecutor` interface has changed significantly.
  Previously, it was defined by chaining `.on` and `.executeFunction`, but it's been changed to simply pass an object similar to `createResolver`.

  before:

  ```typescript
  createExecutor("executor-name", "Executor description")
    .on(recordCreatedTrigger(user, ({ newRecord }) => newRecord.age < 18))
    .executeFunction({
      fn: async ({ newRecord }) => {
        // executor logic here
      },
    });
  ```

  after:

  ```typescript
  createExecutor({
    name: "executor-name",
    description: "Executor description",
    trigger: recordCreatedTrigger({
      type: user,
      condition: ({ newRecord }) => newRecord.age < 18,
    }),
    operation: {
      kind: "function",
      body: async ({ newRecord }) => {
        // executor logic here
      },
    },
  });
  ```

  Additionally, the function set in `body` can now be easily retrieved with typing. This should be useful when you want to execute the function in unit tests, for example.

  ```typescript
  const executor = createExecutor({
    // ...other properties
    operation: {
      kind: "function",
      body: async ({ newRecord }) => {
        // executor logic here
      },
    },
  });

  const body = executor.operation.body;
  ```

## 0.4.0

### Minor Changes

- [#665](https://github.com/tailor-platform/sdk/pull/665) [`16e7cf2`](https://github.com/tailor-platform/sdk/commit/16e7cf2045cfa7dff717ce9001a2925cd5588d5f) Thanks [@toiroakr](https://github.com/toiroakr)! - chore!: rename pipeline -> resolver

## 0.3.0

### Minor Changes

- [#661](https://github.com/tailor-platform/sdk/pull/661) [`bf4583c`](https://github.com/tailor-platform/sdk/commit/bf4583cef16bcc7b88118d2814b2beec28b825dd) Thanks [@t](https://github.com/t)! - feat!: remove TailorType and set typename for resolver

  ## Breaking Changes

  ### Removed `t.type()` - use plain objects for input and `t.object()` for output

  The `t.type()` wrapper has been removed from resolver definitions. Input fields are now passed directly as an object, and output uses `t.object()` instead.

  **Before:**

  ```typescript
  createResolver({
    name: "add",
    operation: "query",
    input: t.type({
      a: t.int(),
      b: t.int(),
    }),
    output: t.type({
      result: t.int(),
    }),
    body: (context) => {
      return { result: context.input.a + context.input.b };
    },
  });
  ```

  **After:**

  ```typescript
  createResolver({
    name: "add",
    operation: "query",
    input: {
      a: t.int(),
      b: t.int(),
    },
    output: t.object({
      result: t.int(),
    }),
    body: (context) => {
      return { result: context.input.a + context.input.b };
    },
  });
  ```

  ## New Feature

  ### Added `typeName()` method for custom GraphQL type names

  You can now set custom GraphQL type names for enum and nested object fields using the `.typeName()` method. This is useful when you want to control the generated GraphQL type names.

  ```typescript
  createResolver({
    name: "stepChain",
    operation: "query",
    input: {

        .object({
          name: t.object({
            first: t.string(),
            last: t.string(),
          }),
          activatedAt: t.datetime({ optional: true }),
        })
        .typeName("StepChainUser"),
    },
    output: t.object({
      result: t.string(),
    }),
    body: (context) => {
      return {
        result: `${context.input.user.name.first} ${context.input.user.name.last}`,
      };
    },
  });
  ```

## 0.2.1

### Patch Changes

- [#658](https://github.com/tailor-platform/sdk/pull/658) [`affac14`](https://github.com/tailor-platform/sdk/commit/affac14e1a33486da3b1540432172018a0e1ca0c) Thanks [@remiposo](https://github.com/remiposo)! - Supported disabling executors

  Made it possible to disable executors by setting the disabled option to true.

  ```typescript
  const disabled = createExecutor("test-executor", {
    disabled: true,
  })
    .on(incomingWebhookTrigger())
    .executeFunction({
      fn: () => {
        // Do something
      },
    });
  ```

## 0.2.0

### Minor Changes

- [#650](https://github.com/tailor-platform/sdk/pull/650) [`fcbcc8d`](https://github.com/tailor-platform/sdk/commit/fcbcc8d35c74b7ae0f458487d4779a07292133aa) Thanks [@remiposo](https://github.com/remiposo)! - Removed unused dbNamespace

  Removed dbNamespace option. While this is a breaking change, it should have minimal impact since it's no longer used. If it's still specified, a type error will occur, so simply remove it.

## 0.1.1

### Patch Changes

- [#647](https://github.com/tailor-platform/sdk/pull/647) [`b3f744b`](https://github.com/tailor-platform/sdk/commit/b3f744bd0db1751951389f013f6c2e4a6b97e743) Thanks [@remiposo](https://github.com/remiposo)! - Added show command

  Added a command to retrieve information about deployed applications. This can be used to obtain application endpoints after deployment in CI and similar environments.

  ```bash
  tailor-sdk apply --workspace-id <your-workspace-id>
  tailor-sdk show --workspace-id <your-workspace-id> -f json | jq -r '.url'
  ```

- [#649](https://github.com/tailor-platform/sdk/pull/649) [`46e0b7b`](https://github.com/tailor-platform/sdk/commit/46e0b7bf56243ea72ae24a477ef9b48779245d49) Thanks [@remiposo](https://github.com/remiposo)! - Added machineuser commands

  ```bash
  tailor-sdk machineuser list --workspace-id <your-workspace-id>
  tailor-sdk machineuser token <machine-user-name> --workspace-id <your-workspace-id>
  ```

## 0.1.0

### Minor Changes

- [#643](https://github.com/tailor-platform/sdk/pull/643) [`793a792`](https://github.com/tailor-platform/sdk/commit/793a7924bd6df4b5c23c5747e1935772ada0c152) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: remove assertNonNull option

  ## Breaking Changes

  ### Removed `assertNonNull` option from field definitions

  The `assertNonNull` option has been removed from field configurations. This option was previously used with `.hooks()` to ensure fields always return non-null values in resolver outputs, even when marked as `optional: true`.

  **Before:**

  ```typescript
  const model = db.type("Model", {
    field: db.string({ optional: true, assertNonNull: true }).hooks({
      create: () => "default-value",
    }),
  });
  ```

  **After:**

  ```typescript
  const model = db.type("Model", {
    field: db.string().hooks({
      create: () => "default-value",
    }),
  });
  ```

  When you use `.hooks()` with a `create` hook that always provides a value, the field should be defined as non-nullable (without `optional: true`).

  ### Serial fields must be non-nullable

  The `.serial()` method can now only be used on non-nullable fields. If you were using `serial()` with `optional: true`, you must remove the `optional: true` option.

  **Before:**

  ```typescript
  const invoice = db.type("Invoice", {
    invoiceNumber: db.string({ optional: true }).serial({
      start: 1000,
      format: "INV-%05d",
    }),
  });
  ```

  **After:**

  ```typescript
  const invoice = db.type("Invoice", {
    invoiceNumber: db.string().serial({
      start: 1000,
      format: "INV-%05d",
    }),
  });
  ```

  ### Hook function argument types

  The `data` parameter in hook functions now treats all fields as optional (`T | null | undefined`), regardless of whether they are required in the schema.

  **Before:**

  ```typescript
  fullAddress: db.string({ optional: true }).hooks({
    create: ({ data }) => `${data.postalCode} ${data.address} ${data.city}`,
    // data.postalCode was guaranteed to be present
  });
  ```

  **After:**

  ```typescript
  fullAddress: db.string({ optional: true }).hooks({
    create: ({ data }) =>
      `${data.postalCode ?? ""} ${data.address ?? ""} ${data.city ?? ""}`,
    // All fields may be undefined - use ?? or add null checks
  });
  ```

## 0.0.99

### Patch Changes

- [#641](https://github.com/tailor-platform/sdk/pull/641) [`fd8b630`](https://github.com/tailor-platform/sdk/commit/fd8b630a7c92263ee377c8bc2a83f76c338d78e4) Thanks [@remiposo](https://github.com/remiposo)! - Rename workspace destory command

- [#645](https://github.com/tailor-platform/sdk/pull/645) [`738a904`](https://github.com/tailor-platform/sdk/commit/738a904d77e5e3f1a65543f2859b0d7f543b2437) Thanks [@remiposo](https://github.com/remiposo)! - Changed to display ID of created workspace

  Made it easier to retrieve the ID of workspaces created with `tailor-sdk workspace create`.
  This is useful for cases where you want to apply after creating a workspace in CI environments and similar scenarios.

  ```bash
  tailor-sdk workspace create --name "my-workspace" --region asia-northeast --format json | jq -r '.id'
  ```

## 0.0.98

### Patch Changes

- [#639](https://github.com/tailor-platform/sdk/pull/639) [`07ef858`](https://github.com/tailor-platform/sdk/commit/07ef85825b51e4a83ab437bad4148d1b33d7a0f1) Thanks [@remiposo](https://github.com/remiposo)! - Adjusted the output format of user commands

## 0.0.97

### Patch Changes

- [#636](https://github.com/tailor-platform/sdk/pull/636) [`ffc1ef7`](https://github.com/tailor-platform/sdk/commit/ffc1ef74e02e9bcf711431709088d1ff2997dd65) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: export generator types

## 0.0.96

### Patch Changes

- [#626](https://github.com/tailor-platform/sdk/pull/626) [`b176af1`](https://github.com/tailor-platform/sdk/commit/b176af18c0ab23a4832517921b233d7206a2e6e6) Thanks [@remiposo](https://github.com/remiposo)! - Changed how workspaceID and authentication credentials are specified

  Previously, authentication credentials were stored in the tailorctl config file (`~/.tailorctl/config`), but we've changed to store them in a new format file (`~/.config/tailor-platform/config.yaml`). When you run SDK commands, migration happens automatically, so generally no user action is required.
  We've also changed how workspaceID is specified during apply. Previously, you specified workspaceID in the configuration file (`tailor.config.ts`), but we've removed this. Instead, please specify `--workspace-id` flag or `TAILOR_PLATFORM_WORKSPACE_ID` environment variable when running the apply command.

  ```bash
  tailor-sdk apply --workspace-id <your-workspace-id>
  # or
  TAILOR_PLATFORM_WORKSPACE_ID=<your-workspace-id> tailor-sdk apply
  ```

- [#634](https://github.com/tailor-platform/sdk/pull/634) [`9b86782`](https://github.com/tailor-platform/sdk/commit/9b8678220375725f0f872deb37ed60a12a1ba124) Thanks [@remiposo](https://github.com/remiposo)! - Added user and profile management commands

  These commands are primarily for making it easier to manage multiple Tailor Platform accounts. The configured content is saved in `.config/tailor-platform/config.yaml` along with authentication credentials.

  ```bash
  # Login to Tailor Platform (add a new user)
  tailor-sdk login

  # Create a new profile
  tailor-sdk profile create <profile-name> --user <user-email> --workspace-id <workspace-id>

  # Apply using a specific profile (no need to specify workspace ID or user credentials)
  tailor-sdk apply --profile <profile-name>
  # or
  TAILOR_PLATFORM_PROFILE=<profile-name> tailor-sdk apply
  ```

## 0.0.95

### Patch Changes

- [#627](https://github.com/tailor-platform/sdk/pull/627) [`6582379`](https://github.com/tailor-platform/sdk/commit/6582379d81c7d5469e27d672c9313a1cb9b81c50) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: unnest resolver input type

  ## Breaking Changes

  The structure of resolver input arguments in GraphQL queries/mutations has changed. Previously, all input fields were nested under a single `input` argument, but now they are passed as flat, top-level arguments.

  ### Migration Guide

  You have two migration options:

  #### Option 1: Update GraphQL queries

  Update your GraphQL queries to pass arguments as flat parameters.

  **Before:**

  ```gql
  query {
    add(input: { a: 1, b: 2 }) {
      result
    }
  }
  ```

  **After:**

  ```gql
  query {
    add(a: 1, b: 2) {
      result
    }
  }
  ```

  #### Option 2: Wrap input type to maintain existing GraphQL API

  If you need to maintain backward compatibility with existing GraphQL queries, wrap your input type in a single `input` field:

  ```typescript
  createResolver({
    name: "add",
    operation: "query",
    input: t.type({
      input: t.object({
        a: t.int(),
        b: t.int(),
      }),
    }),
    body: (context) => {
      return { result: context.input.input.a + context.input.input.b };
    },
    output: t.type({ result: t.int() }),
  });
  ```

  This way, your existing GraphQL queries with `add(input: { a: 1, b: 2 })` will continue to work.

## 0.0.94

### Patch Changes

- [#623](https://github.com/tailor-platform/sdk/pull/623) [`452a5d7`](https://github.com/tailor-platform/sdk/commit/452a5d7904d1b04b26638fce337d865b358f1f5b) Thanks [@remiposo](https://github.com/remiposo)! - Made all commands accept the --env-file flag

- [#621](https://github.com/tailor-platform/sdk/pull/621) [`6291874`](https://github.com/tailor-platform/sdk/commit/629187471b0189331445ad179f9cfae91902a0a4) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: validate resolver input

- [#625](https://github.com/tailor-platform/sdk/pull/625) [`d08ec14`](https://github.com/tailor-platform/sdk/commit/d08ec14886f91a71c6358d58db7e0f16d3f06ebe) Thanks [@remiposo](https://github.com/remiposo)! - Display stack trace only when the --verbose flag is specified

## 0.0.93

### Patch Changes

- [#617](https://github.com/tailor-platform/sdk/pull/617) [`d45fe83`](https://github.com/tailor-platform/sdk/commit/d45fe834398426c94e5239e9bc94a5736df87016) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add tailordb.Client mock for apply

- [#613](https://github.com/tailor-platform/sdk/pull/613) [`62c8fe3`](https://github.com/tailor-platform/sdk/commit/62c8fe35e50e14778db57ccd8e517b1b44dbdfbd) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update documentation structure

## 0.0.92

### Patch Changes

- [#607](https://github.com/tailor-platform/sdk/pull/607) [`ab2cadd`](https://github.com/tailor-platform/sdk/commit/ab2cadd9f92ac488ae1963d0768e2ca96ec66e0f) Thanks [@toiroakr](https://github.com/toiroakr)! - refactor: move inflection to out of configuration

## 0.0.91

### Patch Changes

- [#601](https://github.com/tailor-platform/sdk/pull/601) [`4f2803a`](https://github.com/tailor-platform/sdk/commit/4f2803a1ab00a28d466f86764955656e8ea23829) Thanks [@remiposo](https://github.com/remiposo)! - Add workspace management comand

- [#606](https://github.com/tailor-platform/sdk/pull/606) [`f1be4bf`](https://github.com/tailor-platform/sdk/commit/f1be4bf0f324e5ea1896fa4c1a9415b48eb0b134) Thanks [@toiroakr](https://github.com/toiroakr)! - feat!: kysely-db generator renewal

- [#604](https://github.com/tailor-platform/sdk/pull/604) [`491626b`](https://github.com/tailor-platform/sdk/commit/491626b65bbde4bfebe45b542ef3bcea7b13fde1) Thanks [@remiposo](https://github.com/remiposo)! - Add login/logout command

## 0.0.90

### Patch Changes

- [#598](https://github.com/tailor-platform/sdk/pull/598) [`7b2ffaf`](https://github.com/tailor-platform/sdk/commit/7b2ffaf47b8f324bf489c7734f566be320dd69cc) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: improve url schema

- [#600](https://github.com/tailor-platform/sdk/pull/600) [`ec16341`](https://github.com/tailor-platform/sdk/commit/ec16341c0d5aaf5c786f03216ab5642ff4fe7683) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: remove callbackUrl from defineStaticWebsite

## 0.0.89

### Patch Changes

- [#597](https://github.com/tailor-platform/sdk/pull/597) [`36ea41c`](https://github.com/tailor-platform/sdk/commit/36ea41c4fea9c4d6ff4b5b1d7fd8582ceae09c89) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: stricter define function types

- [#595](https://github.com/tailor-platform/sdk/pull/595) [`2d3f019`](https://github.com/tailor-platform/sdk/commit/2d3f01977bcf271a8874fc5f6d273d6c1c1561f8) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add defineIdp

## 0.0.88

### Patch Changes

- [#594](https://github.com/tailor-platform/sdk/pull/594) [`ac244cd`](https://github.com/tailor-platform/sdk/commit/ac244cd7769cfe92a962ea48918559dd403991df) Thanks [@toiroakr](https://github.com/toiroakr)! - feat: add defineStaticWebsite

- [#589](https://github.com/tailor-platform/sdk/pull/589) [`5195548`](https://github.com/tailor-platform/sdk/commit/5195548158aa61fe7b33a75a4812d5345adde3da) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: type guard for workspaceId

## 0.0.87

### Patch Changes

- [#585](https://github.com/tailor-platform/sdk/pull/585) [`3f13d44`](https://github.com/tailor-platform/sdk/commit/3f13d4463047862cfe438f71d87629e49320c6eb) Thanks [@toiroakr](https://github.com/toiroakr)! - chore: update resolver schema

## 0.0.86

### Patch Changes

- [#575](https://github.com/tailor-platform/sdk/pull/575) [`0d64a86`](https://github.com/tailor-platform/sdk/commit/0d64a869766049ffb8462dace6222db53e23dbce) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: strict resolver output type

## 0.0.85

### Patch Changes

- [#573](https://github.com/tailor-platform/sdk/pull/573) [`11cae3e`](https://github.com/tailor-platform/sdk/commit/11cae3e8aa89fc8d71993a0bb9e28c02123f185f) Thanks [@toiroakr](https://github.com/toiroakr)! - fix: generated type reference

## 0.0.84

### Patch Changes

- [#570](https://github.com/tailor-platform/sdk/pull/570) [`20b760e`](https://github.com/tailor-platform/sdk/commit/20b760e9b3f85e200ed9ec7d1bef73efbc2f1299) Thanks [@remiposo](https://github.com/remiposo)! - Use type import in kysely generator

## 0.0.83

### Patch Changes

- [#559](https://github.com/tailor-platform/sdk/pull/559) [`ebcb667`](https://github.com/tailor-platform/sdk/commit/ebcb6674bbc1fc3ac819bb0e2930255a660ade1b) Thanks [@toiroakr](https://github.com/toiroakr)! - Remove steps from resolver

## 0.0.82

### Patch Changes

- [#563](https://github.com/tailor-platform/sdk/pull/563) [`14333f9`](https://github.com/tailor-platform/sdk/commit/14333f9eac7eb53f4856388c367b8e00e16e86de) Thanks [@remiposo](https://github.com/remiposo)! - Fixed to set more appropriate GraphQL types in pipeline input / output

- [#565](https://github.com/tailor-platform/sdk/pull/565) [`dbaa31e`](https://github.com/tailor-platform/sdk/commit/dbaa31e74522fd34dde3bd3e3b71b4190cfdf514) Thanks [@remiposo](https://github.com/remiposo)! - fix: ensure the vault and secret exist

- [#558](https://github.com/tailor-platform/sdk/pull/558) [`ce877a1`](https://github.com/tailor-platform/sdk/commit/ce877a1ff421e8f3f902d3902cfa66b3ea2bae51) Thanks [@remiposo](https://github.com/remiposo)! - feat: Remove client from exectutor args when dbNamespace is not specified

## 0.0.81

### Patch Changes

- [#552](https://github.com/tailor-platform/sdk/pull/552) [`c9f10c5`](https://github.com/tailor-platform/sdk/commit/c9f10c5ca80ebb1e282b3639e2b7a24b4aefba7d) Thanks [@toiroakr](https://github.com/toiroakr)! - Simplified permission definitions with automatic type generation

## 0.0.80

### Patch Changes

- [#548](https://github.com/tailor-platform/sdk/pull/548) [`ce834be`](https://github.com/tailor-platform/sdk/commit/ce834bec7c7d80a3f56a520339a569fef9225888) Thanks [@toiroakr](https://github.com/toiroakr)! - kysely-type generator: support assertNonNull

## 0.0.79

### Patch Changes

- [#545](https://github.com/tailor-platform/sdk/pull/545) [`e82a038`](https://github.com/tailor-platform/sdk/commit/e82a038b022ebf58dd377a247b7bdf1fa608701c) Thanks [@remiposo](https://github.com/remiposo)! - chore: Add LICENSE

## 0.0.78

### Patch Changes

- [#535](https://github.com/tailor-platform/sdk/pull/535) [`fd011ba`](https://github.com/tailor-platform/sdk/commit/fd011ba2a0c3719d87a3e5434f86aacc11a52ba8) Thanks [@remiposo](https://github.com/remiposo)! - fix: remove unusable variables from executeFunction/executeJobFunction

- [#527](https://github.com/tailor-platform/sdk/pull/527) [`f9eae29`](https://github.com/tailor-platform/sdk/commit/f9eae29e80238e9783e831a7ec02c5a3583d03b6) Thanks [@remiposo](https://github.com/remiposo)! - refactor: Executor service

## 0.0.77

### Patch Changes

- [#524](https://github.com/tailor-platform/sdk/pull/524) [`5f0272a`](https://github.com/tailor-platform/sdk/commit/5f0272a35b6ab24b69f781123477bc42e50e02cd) Thanks [@remiposo](https://github.com/remiposo)! - test: add incomingWebhookTrigger test cases

## 0.0.76

### Patch Changes

- [#521](https://github.com/tailor-platform/sdk/pull/521) [`f380645`](https://github.com/tailor-platform/sdk/commit/f3806455815ed4efd80cfe11428bd7862c77b401) Thanks [@remiposo](https://github.com/remiposo)! - chore: Update CHANGELOG.md format

## 0.0.75

### Patch Changes

- dca9f5b: Separate generator config from defineConfig

## 0.0.74

### Patch Changes

- e41001c: refactor: Remove any related to relation
- c1a972a: fix: Fixed the issue where fn arguments became never for scheduleTrigger

## 0.0.73

### Patch Changes

- 9be7344: Change defineConfig to be tailored specifically for a single app
- 6d5b956: Fixed deps so that the cron type for schedule triggers works properly

## 0.0.72

### Patch Changes

- ea06320: Fixed the issue where relations couldn't be set to fields other than `id`

  Fixed deployment errors caused by always trying to set foreign keys to `id`, and now foreign keys are set to the correct fields.

## 0.0.71

### Patch Changes

- 9f7a52c: Add CHANGELOG.md
