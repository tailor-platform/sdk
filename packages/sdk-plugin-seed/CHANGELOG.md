# @tailor-platform/sdk-plugin-seed

## 0.1.0-next.1

### Minor Changes

- [#1807](https://github.com/tailor-platform/sdk/pull/1807) [`817454f`](https://github.com/tailor-platform/sdk/commit/817454fff35e4093bce5fdcb9e1fcda8bbd1d7ef) Thanks [@dqn](https://github.com/dqn)! - New Tailor CLI plugin providing the `tailor seed` commands (`apply`, `validate`), extracted from the `exec.mjs` script that `seedPlugin` used to generate. `tailor seed apply` seeds TailorDB (and IdP `_User`) data from the generated JSONL files with the same options as the old script (`--machine-user`, `--namespace`, `--skip-idp`, `--truncate`, `--yes`, type-name arguments), and `tailor seed validate` validates the JSONL data against the generated schemas. The machine user and data location now come from the seedPlugin options in `tailor.config.ts` at run time.

### Patch Changes

- Updated dependencies [[`b2fc104`](https://github.com/tailor-platform/sdk/commit/b2fc104d9cdfc52e98c97bc18d80a9e2e9d5f4c2), [`817454f`](https://github.com/tailor-platform/sdk/commit/817454fff35e4093bce5fdcb9e1fcda8bbd1d7ef)]:
  - @tailor-platform/sdk@2.0.0-next.9
