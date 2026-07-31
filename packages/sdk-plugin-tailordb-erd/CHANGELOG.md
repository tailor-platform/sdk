# @tailor-platform/sdk-tailordb-erd-plugin

## 0.1.0-next.3

### Patch Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`884d6a0`](https://github.com/tailor-platform/sdk/commit/884d6a08e224a739985a4ae75e0fcc9366c5e2ee) Thanks [@toiroakr](https://github.com/toiroakr)! - Resolve the `tailor-tailordb-erd` bin through a committed launcher so package managers link it even when `dist/` has not been built yet (pnpm skips bins whose target file does not exist at install time).

- [#1837](https://github.com/tailor-platform/sdk/pull/1837) [`b74966b`](https://github.com/tailor-platform/sdk/commit/b74966bcefa499df1cbb5ef7e36ca76442658579) Thanks [@toiroakr](https://github.com/toiroakr)! - Update politty to v0.11.3
- Updated dependencies [[`dd85b74`](https://github.com/tailor-platform/sdk/commit/dd85b74352ecaff96cd79f2481cc177d08fbfc96), [`7224091`](https://github.com/tailor-platform/sdk/commit/7224091b2a738f5daa0b38344c138854d64d0c4d), [`c99f055`](https://github.com/tailor-platform/sdk/commit/c99f055da1a9e05b573c8b62841048da74259ae8), [`50af713`](https://github.com/tailor-platform/sdk/commit/50af713d3b41fbe64fa2b53a2f2d027e6f7dbe9f), [`1006f98`](https://github.com/tailor-platform/sdk/commit/1006f987a0d8dcbabcaa548d7f3d82e352b9434a), [`ca804f2`](https://github.com/tailor-platform/sdk/commit/ca804f24ad9506995757e81422d8b6df5316b6c7), [`f1ca847`](https://github.com/tailor-platform/sdk/commit/f1ca847e683ecff8bbb634b3cf7a67ec18429d59), [`fae3fbd`](https://github.com/tailor-platform/sdk/commit/fae3fbde9cbc6af8d37d3e254ecaf48b5219d6af), [`6f6023d`](https://github.com/tailor-platform/sdk/commit/6f6023d96f9665df1b62e49f200e2083d7811629), [`b74966b`](https://github.com/tailor-platform/sdk/commit/b74966bcefa499df1cbb5ef7e36ca76442658579)]:
  - @tailor-platform/sdk@2.0.0-next.10

## 0.1.0-next.2

### Minor Changes

- [#1811](https://github.com/tailor-platform/sdk/pull/1811) [`b2fc104`](https://github.com/tailor-platform/sdk/commit/b2fc104d9cdfc52e98c97bc18d80a9e2e9d5f4c2) Thanks [@toiroakr](https://github.com/toiroakr)! - Move the TailorDB `erdSite` setting out of the core config schema into the ERD plugin's own configuration. `db.<namespace>.erdSite` is no longer accepted in `tailor.config.ts`; configure the ERD deploy target on the plugin instead:
  
  ```ts
  import { definePlugins } from "@tailor-platform/sdk";
  import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";
  
  export const plugins = definePlugins(
    // TailorDB namespace name → static website name
    tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
  );
  ```
  
  The `tailor tailordb erd` commands resolve deploy targets from `tailordbErdPlugin({ sites })` and now validate each namespace against `config.db` and each site name against `staticWebsites`, so typos surface when the config is loaded instead of at deploy time. The `v2/erd-site-to-plugin` codemod migrates existing configs automatically. For programmatic users, `loadTailorDBNamespaces()` additionally returns the config module's registered `plugins`, and namespace selector callbacks receive them as a second argument.

### Patch Changes

- Updated dependencies [[`b2fc104`](https://github.com/tailor-platform/sdk/commit/b2fc104d9cdfc52e98c97bc18d80a9e2e9d5f4c2), [`817454f`](https://github.com/tailor-platform/sdk/commit/817454fff35e4093bce5fdcb9e1fcda8bbd1d7ef)]:
  - @tailor-platform/sdk@2.0.0-next.9

## 0.1.0-next.1

### Minor Changes

- [#1801](https://github.com/tailor-platform/sdk/pull/1801) [`ee382c7`](https://github.com/tailor-platform/sdk/commit/ee382c7d5f5c0a14acf47c1dee6f12d8cecad92d) Thanks [@toiroakr](https://github.com/toiroakr)! - Renamed the package from `@tailor-platform/sdk-tailordb-erd-plugin` to `@tailor-platform/sdk-plugin-tailordb-erd`, following the `eslint-plugin-*`-style naming convention used for CLI plugin packages. Update your dependency to the new name; the `tailor-tailordb-erd` executable and the `tailor tailordb erd` commands are unchanged.

### Patch Changes

- Updated dependencies [[`f1cbda5`](https://github.com/tailor-platform/sdk/commit/f1cbda56df96670f18dccf2b7f2473430584f377), [`c870196`](https://github.com/tailor-platform/sdk/commit/c8701961f90d7bdcc887c793c806d4f26cc9b197), [`d07a82a`](https://github.com/tailor-platform/sdk/commit/d07a82aa4ded74c3d84e157b4bed5c37ef0ec239), [`da7d0c4`](https://github.com/tailor-platform/sdk/commit/da7d0c49322deebc9343dee88652152620a7cef9), [`cb97bd4`](https://github.com/tailor-platform/sdk/commit/cb97bd45314c5897818233dc8bc3b84b83bea8a3), [`ee382c7`](https://github.com/tailor-platform/sdk/commit/ee382c7d5f5c0a14acf47c1dee6f12d8cecad92d), [`c971797`](https://github.com/tailor-platform/sdk/commit/c971797c9bfa035a43771c46f2b1c3bd93f989a9), [`c971797`](https://github.com/tailor-platform/sdk/commit/c971797c9bfa035a43771c46f2b1c3bd93f989a9)]:
  - @tailor-platform/sdk@2.0.0-next.7

## 0.1.0-next.0

### Minor Changes

- [#1776](https://github.com/tailor-platform/sdk/pull/1776) [`7338457`](https://github.com/tailor-platform/sdk/commit/733845732fabff504c32b725f6919be6167bc7a1) Thanks [@dqn](https://github.com/dqn)! - New Tailor CLI plugin providing the `tailor tailordb erd` commands (export, diff, serve, deploy), extracted from `@tailor-platform/sdk`.

### Patch Changes

- Updated dependencies [[`7338457`](https://github.com/tailor-platform/sdk/commit/733845732fabff504c32b725f6919be6167bc7a1), [`7338457`](https://github.com/tailor-platform/sdk/commit/733845732fabff504c32b725f6919be6167bc7a1), [`9837182`](https://github.com/tailor-platform/sdk/commit/983718288eab23a4c15762c179a67569dd78a287), [`1316447`](https://github.com/tailor-platform/sdk/commit/13164471cc934da03dd64640b2fb2457c79b4413), [`000db7e`](https://github.com/tailor-platform/sdk/commit/000db7ef91b699918a8da600faa183ebcb40ba7c), [`36ad006`](https://github.com/tailor-platform/sdk/commit/36ad006f9eb2d23b21b2028741dbce1d6ba9f91b), [`322b69c`](https://github.com/tailor-platform/sdk/commit/322b69c843953551ccb4b32d7cbd528ae2b0e10c), [`813f86e`](https://github.com/tailor-platform/sdk/commit/813f86eb0b0df1a768db5de6a39a550d6633749a), [`09f5691`](https://github.com/tailor-platform/sdk/commit/09f5691ef5a76761812f039d125d33eb3211994a)]:
  - @tailor-platform/sdk@2.0.0-next.6
