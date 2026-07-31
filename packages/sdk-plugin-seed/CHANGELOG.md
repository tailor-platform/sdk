# @tailor-platform/sdk-plugin-seed

## 0.1.0-next.3

### Minor Changes

- [#1910](https://github.com/tailor-platform/sdk/pull/1910) [`3153400`](https://github.com/tailor-platform/sdk/commit/3153400e27d8fefcdc6d7c0d0c5ab902f4bb73a3) Thanks [@dqn](https://github.com/dqn)! - Add an `--upsert` flag to `tailor seed apply`. Without it, seeding a workspace that already holds some of the rows fails the whole batch for that type on the first duplicate id and inserts nothing. With `--upsert`, every TailorDB row must include an `id` (and any field its type requires); rows with new ids are inserted, rows with existing ids are updated, and omitted optional fields keep their stored values. Built-In IdP users are created or updated by name, with separate counts for each result. Default behavior is unchanged.

### Patch Changes

- Fix `tailor seed apply --upsert` for the Built-In IdP `_User` entity: a seed row with no attributes beyond `name` is now counted as skipped instead of triggering a no-op update, no success line is printed when every `_User` row fails, and a lookup failure is no longer swallowed when the following create also fails (the error now reports both). Also documents that `--upsert` updates run through the same update path as any other write, so update hooks, validation, and `recordUpdatedTrigger` executors apply to updated rows.
- Updated dependencies [[`7ec64b3`](https://github.com/tailor-platform/sdk/commit/7ec64b30ddf8d2a4850a2da31e9afbe3b1502d1c), [`e1fd100`](https://github.com/tailor-platform/sdk/commit/e1fd100567da6c2903c1ad9697ecd4956b445cef), [`e1fd100`](https://github.com/tailor-platform/sdk/commit/e1fd100567da6c2903c1ad9697ecd4956b445cef), [`dc691ec`](https://github.com/tailor-platform/sdk/commit/dc691ec1e2181400c6715233f0588a1b5150038f), [`470c2c0`](https://github.com/tailor-platform/sdk/commit/470c2c034645c6e72ba4c346f7a5ef6fe8bd5d68), [`e1fd100`](https://github.com/tailor-platform/sdk/commit/e1fd100567da6c2903c1ad9697ecd4956b445cef), [`a7343a5`](https://github.com/tailor-platform/sdk/commit/a7343a5976ece5ae66febe713ae04e97dfd9bee5), [`493e0db`](https://github.com/tailor-platform/sdk/commit/493e0db4f89799a02cbd223b24e2928335eca1a7), [`b837eea`](https://github.com/tailor-platform/sdk/commit/b837eea64fd382c9fd87d422b49d4c0796cae6e9), [`aca3544`](https://github.com/tailor-platform/sdk/commit/aca35440085dc100fe06153fe4f0eeab5b200f72), [`a4cdee0`](https://github.com/tailor-platform/sdk/commit/a4cdee079707105213f8e5833dcaa613f39c8464), [`3153400`](https://github.com/tailor-platform/sdk/commit/3153400e27d8fefcdc6d7c0d0c5ab902f4bb73a3), [`e1fd100`](https://github.com/tailor-platform/sdk/commit/e1fd100567da6c2903c1ad9697ecd4956b445cef), [`80142c3`](https://github.com/tailor-platform/sdk/commit/80142c35cda8bc7aff539855c2d1df5b84db4c65), [`e1fd100`](https://github.com/tailor-platform/sdk/commit/e1fd100567da6c2903c1ad9697ecd4956b445cef)]:
  - @tailor-platform/sdk@2.0.0-next.11

## 0.1.0-next.2

### Patch Changes

- [#1832](https://github.com/tailor-platform/sdk/pull/1832) [`9f8c826`](https://github.com/tailor-platform/sdk/commit/9f8c8269560477c5ac9eda0f01d6a296a9b1ceec) Thanks [@dqn](https://github.com/dqn)! - Fail `tailor seed apply` before any remote operations when selected seed targets require generated data but the data directory is missing.

- [#1855](https://github.com/tailor-platform/sdk/pull/1855) [`fae3fbd`](https://github.com/tailor-platform/sdk/commit/fae3fbde9cbc6af8d37d3e254ecaf48b5219d6af) Thanks [@dqn](https://github.com/dqn)! - Emit structured JSON error envelopes on stderr when `tailor seed` fails before command-specific output.

- [#1852](https://github.com/tailor-platform/sdk/pull/1852) [`4bdffc9`](https://github.com/tailor-platform/sdk/commit/4bdffc910c7b3a075ddc6b68798ec42cf0469d92) Thanks [@dqn](https://github.com/dqn)! - Treat seed apply with no selected targets as a successful no-op before authentication or truncation

- [#1837](https://github.com/tailor-platform/sdk/pull/1837) [`b74966b`](https://github.com/tailor-platform/sdk/commit/b74966bcefa499df1cbb5ef7e36ca76442658579) Thanks [@toiroakr](https://github.com/toiroakr)! - Update politty to v0.11.3
- Updated dependencies [[`dd85b74`](https://github.com/tailor-platform/sdk/commit/dd85b74352ecaff96cd79f2481cc177d08fbfc96), [`7224091`](https://github.com/tailor-platform/sdk/commit/7224091b2a738f5daa0b38344c138854d64d0c4d), [`c99f055`](https://github.com/tailor-platform/sdk/commit/c99f055da1a9e05b573c8b62841048da74259ae8), [`50af713`](https://github.com/tailor-platform/sdk/commit/50af713d3b41fbe64fa2b53a2f2d027e6f7dbe9f), [`1006f98`](https://github.com/tailor-platform/sdk/commit/1006f987a0d8dcbabcaa548d7f3d82e352b9434a), [`ca804f2`](https://github.com/tailor-platform/sdk/commit/ca804f24ad9506995757e81422d8b6df5316b6c7), [`f1ca847`](https://github.com/tailor-platform/sdk/commit/f1ca847e683ecff8bbb634b3cf7a67ec18429d59), [`fae3fbd`](https://github.com/tailor-platform/sdk/commit/fae3fbde9cbc6af8d37d3e254ecaf48b5219d6af), [`6f6023d`](https://github.com/tailor-platform/sdk/commit/6f6023d96f9665df1b62e49f200e2083d7811629), [`b74966b`](https://github.com/tailor-platform/sdk/commit/b74966bcefa499df1cbb5ef7e36ca76442658579)]:
  - @tailor-platform/sdk@2.0.0-next.10

## 0.1.0-next.1

### Minor Changes

- [#1807](https://github.com/tailor-platform/sdk/pull/1807) [`817454f`](https://github.com/tailor-platform/sdk/commit/817454fff35e4093bce5fdcb9e1fcda8bbd1d7ef) Thanks [@dqn](https://github.com/dqn)! - New Tailor CLI plugin providing the `tailor seed` commands (`apply`, `validate`), extracted from the `exec.mjs` script that `seedPlugin` used to generate. `tailor seed apply` seeds TailorDB (and IdP `_User`) data from the generated JSONL files with the same options as the old script (`--machine-user`, `--namespace`, `--skip-idp`, `--truncate`, `--yes`, type-name arguments), and `tailor seed validate` validates the JSONL data against the generated schemas. The machine user and data location now come from the seedPlugin options in `tailor.config.ts` at run time.

### Patch Changes

- Updated dependencies [[`b2fc104`](https://github.com/tailor-platform/sdk/commit/b2fc104d9cdfc52e98c97bc18d80a9e2e9d5f4c2), [`817454f`](https://github.com/tailor-platform/sdk/commit/817454fff35e4093bce5fdcb9e1fcda8bbd1d7ef)]:
  - @tailor-platform/sdk@2.0.0-next.9
