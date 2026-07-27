# @tailor-platform/sdk-plugin-seed

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
