# @tailor-platform/sdk-tailordb-erd-plugin

## 0.1.1

### Patch Changes

- [#1955](https://github.com/tailor-platform/sdk/pull/1955) [`09fb1c2`](https://github.com/tailor-platform/sdk/commit/09fb1c20e9d8d47162d6a66ee56f33ec50b8bff0) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency politty to v0.11.6
- Updated dependencies [[`a465547`](https://github.com/tailor-platform/sdk/commit/a465547df712ca8c607c1e42cf12c15fe3e830d1), [`8af9031`](https://github.com/tailor-platform/sdk/commit/8af9031aee675da1d570d29ed18e76287ea0c184), [`0871279`](https://github.com/tailor-platform/sdk/commit/0871279e943f1f5dfa1fbe6ad838b6485cb3c0a0), [`e78df40`](https://github.com/tailor-platform/sdk/commit/e78df401bc46cfe6aeada19f0551a97f454cc1db), [`0f73487`](https://github.com/tailor-platform/sdk/commit/0f734878c4c2115ec5f59eb5870e98862b6541ba)]:
  - @tailor-platform/sdk@2.0.1

## 0.1.0

### Minor Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`7d5ce90`](https://github.com/tailor-platform/sdk/commit/7d5ce90fc4e008a4b049f03877b15b5d1654b4ae) Thanks [@toiroakr](https://github.com/toiroakr)! - New Tailor CLI plugin providing the `tailor tailordb erd` commands (export, diff, serve, deploy), extracted from `@tailor-platform/sdk`.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`a6038e2`](https://github.com/tailor-platform/sdk/commit/a6038e25151bf32694cc2d20fd3845b1ed959ccc) Thanks [@toiroakr](https://github.com/toiroakr)! - Move the TailorDB `erdSite` setting out of the core config schema into the ERD plugin's own configuration. `db.<namespace>.erdSite` is no longer accepted in `tailor.config.ts`; configure the ERD deploy target on the plugin instead:
  
  ```ts
  import { definePlugins } from "@tailor-platform/sdk";
  import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";
  
  export const plugins = definePlugins(
    // TailorDB namespace name → static website name
    tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
  );
  ```
  
  The `tailor tailordb erd` commands resolve deploy targets from `tailordbErdPlugin({ sites })` and now validate each namespace against `config.db` and each site name against `staticWebsites`, so typos surface when the config is loaded instead of at deploy time. The `v2/erd-site-to-plugin` codemod migrates existing configs automatically. For programmatic users, `loadTailorDBNamespaces()` additionally returns the config module's registered `plugins`, and namespace selector callbacks receive them as a second argument.

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`6a714b5`](https://github.com/tailor-platform/sdk/commit/6a714b50288bb22e60dd4f99a5632731b67e49fd) Thanks [@toiroakr](https://github.com/toiroakr)! - Renamed the package from `@tailor-platform/sdk-tailordb-erd-plugin` to `@tailor-platform/sdk-plugin-tailordb-erd`, following the `eslint-plugin-*`-style naming convention used for CLI plugin packages. Update your dependency to the new name; the `tailor-tailordb-erd` executable and the `tailor tailordb erd` commands are unchanged.

### Patch Changes

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`822c9b9`](https://github.com/tailor-platform/sdk/commit/822c9b968fef3f161a9135e63b959e170cfd7328) Thanks [@toiroakr](https://github.com/toiroakr)! - Resolve the `tailor-tailordb-erd` bin through a committed launcher so package managers link it even when `dist/` has not been built yet (pnpm skips bins whose target file does not exist at install time).

- [#1808](https://github.com/tailor-platform/sdk/pull/1808) [`bf11bf8`](https://github.com/tailor-platform/sdk/commit/bf11bf8d3bad6195c86ed289c764490dc6d680ee) Thanks [@toiroakr](https://github.com/toiroakr)! - Update politty to v0.11.3
- Updated dependencies [[`0dd0313`](https://github.com/tailor-platform/sdk/commit/0dd0313590d796bc254d7e2c7c515fa4a0636701), [`6519a54`](https://github.com/tailor-platform/sdk/commit/6519a5434f0cc664a609ef2cae2398b19cad4673), [`40b9533`](https://github.com/tailor-platform/sdk/commit/40b953350445c6921aa46895e0061bbb82484ea4), [`2056a5c`](https://github.com/tailor-platform/sdk/commit/2056a5ca1ade011b25cc2da26af6d7ff45c05fdb), [`7d5ce90`](https://github.com/tailor-platform/sdk/commit/7d5ce90fc4e008a4b049f03877b15b5d1654b4ae), [`054a79f`](https://github.com/tailor-platform/sdk/commit/054a79f1ce631b534751cabe6afd744effe9c54f), [`8b918f6`](https://github.com/tailor-platform/sdk/commit/8b918f68867240b5713c5f8340836971d1c30882), [`1a055c9`](https://github.com/tailor-platform/sdk/commit/1a055c9909ac951f807fc2249c9abc1d5805398f), [`2056a5c`](https://github.com/tailor-platform/sdk/commit/2056a5ca1ade011b25cc2da26af6d7ff45c05fdb), [`039389d`](https://github.com/tailor-platform/sdk/commit/039389d17ddf3014fc53ffdb756ec6ea1425826c), [`fb6a396`](https://github.com/tailor-platform/sdk/commit/fb6a3962b161fb57fb4a71153e78f69d9a7bd7e7), [`a6038e2`](https://github.com/tailor-platform/sdk/commit/a6038e25151bf32694cc2d20fd3845b1ed959ccc), [`4022203`](https://github.com/tailor-platform/sdk/commit/40222035a5de08e1d0d3e7b8d96047fdbd2b2d19), [`7d5ce90`](https://github.com/tailor-platform/sdk/commit/7d5ce90fc4e008a4b049f03877b15b5d1654b4ae), [`54f4d08`](https://github.com/tailor-platform/sdk/commit/54f4d085e077913ae3a923bcb520362b9e57d876), [`210b51c`](https://github.com/tailor-platform/sdk/commit/210b51c55335358936b2fe4ff286d5254dd9ccbf), [`8665cbb`](https://github.com/tailor-platform/sdk/commit/8665cbba86a115ca6db7b59e92d980f14f1bc974), [`4ca14e7`](https://github.com/tailor-platform/sdk/commit/4ca14e7173c06caf01524703ec1d944b54948bde), [`fb972c6`](https://github.com/tailor-platform/sdk/commit/fb972c643e75182f42dd67c6e86cf9fbc907e214), [`63cc1b1`](https://github.com/tailor-platform/sdk/commit/63cc1b149c47441099342382dcb78d8618f94eea), [`af2e3a6`](https://github.com/tailor-platform/sdk/commit/af2e3a6672ff92a93ce2b0973abc85d12dc801a9), [`2056a5c`](https://github.com/tailor-platform/sdk/commit/2056a5ca1ade011b25cc2da26af6d7ff45c05fdb), [`b6340d0`](https://github.com/tailor-platform/sdk/commit/b6340d086822fbf5bd6fffa16a7dba47ccc3a59a), [`d1405c0`](https://github.com/tailor-platform/sdk/commit/d1405c0b0dbd6205c1817c79b239fe980906c19b), [`cd48fda`](https://github.com/tailor-platform/sdk/commit/cd48fdab46746aa2e8f5d8dd43073e3b4832c07c), [`9c74fa5`](https://github.com/tailor-platform/sdk/commit/9c74fa552f368c06f9c0246bde107ed8a4e1a50b), [`ecf8e57`](https://github.com/tailor-platform/sdk/commit/ecf8e5770f2952fd1923dfdec2173210977f1bcb), [`85260a6`](https://github.com/tailor-platform/sdk/commit/85260a650c4fe49eafd25c2699954690f0a3fca9), [`2d5c289`](https://github.com/tailor-platform/sdk/commit/2d5c2896ba5c0ae2bc12ed67a5eaa5b67b7b4edc), [`13670ce`](https://github.com/tailor-platform/sdk/commit/13670ce75f36bf006f4018eb948cbde5e18b3293), [`577c4fc`](https://github.com/tailor-platform/sdk/commit/577c4fcb0ef0a2bae705e7b592b3e93eaaedc920), [`6374ec6`](https://github.com/tailor-platform/sdk/commit/6374ec64f3602c35ed2b2e45ba2260591327fafb), [`1c7b3a1`](https://github.com/tailor-platform/sdk/commit/1c7b3a1c72aacd6b62a1464bc9b56253f18b2c6e), [`7240c25`](https://github.com/tailor-platform/sdk/commit/7240c252546dc69989755a6f5af26c6062c36883), [`019ed88`](https://github.com/tailor-platform/sdk/commit/019ed886cdc25851371d70b2e6c95b2b83e37eac), [`0a04aea`](https://github.com/tailor-platform/sdk/commit/0a04aea5b3da05f2eeecfac0cde52def31a66640), [`7700619`](https://github.com/tailor-platform/sdk/commit/7700619ea1a8cd2d460c7d11d91183557c49e937), [`08f6a58`](https://github.com/tailor-platform/sdk/commit/08f6a58c4871d848ca4e446157936ef3e4512398), [`1ac7a9f`](https://github.com/tailor-platform/sdk/commit/1ac7a9f16c5babd2db8b67cdaf2bccfd9ba9fabe), [`0676403`](https://github.com/tailor-platform/sdk/commit/0676403f0c2686a9b861047af105661bf52e9d9a), [`304a24a`](https://github.com/tailor-platform/sdk/commit/304a24af51cc130268a7f8145a10dc6b165f8d46), [`e62f97d`](https://github.com/tailor-platform/sdk/commit/e62f97d8264783c85b7d949e9cd131264e8b8336), [`621de2c`](https://github.com/tailor-platform/sdk/commit/621de2c0ef4e67ec4a22d036b7c0ec5b376f6b6e), [`2167a7e`](https://github.com/tailor-platform/sdk/commit/2167a7e0bd79f3a241a556cb2f3bebad564e26a1), [`88db10e`](https://github.com/tailor-platform/sdk/commit/88db10ef57fa575731e1ed557ea74b86edcf5c5c), [`20aa5a9`](https://github.com/tailor-platform/sdk/commit/20aa5a95167d370b4b3cc7352cb60a22a695d673), [`19c3c85`](https://github.com/tailor-platform/sdk/commit/19c3c857eaed69fc685ba3888741fe11778ff534), [`160b406`](https://github.com/tailor-platform/sdk/commit/160b4061ee38675df85dd74af23b7041fe8e4944), [`908c683`](https://github.com/tailor-platform/sdk/commit/908c683aa83bcbba736c7224ee007a3fc05c2f99), [`8b03f82`](https://github.com/tailor-platform/sdk/commit/8b03f827642e64f3b3af5a05ecdef405028a803a), [`d37d86a`](https://github.com/tailor-platform/sdk/commit/d37d86a3695522ac1a92fc8d0bd767bd06fade9e), [`3dcd82d`](https://github.com/tailor-platform/sdk/commit/3dcd82d54d6c059df90f2dc4788a7059fe4004ab), [`04ca361`](https://github.com/tailor-platform/sdk/commit/04ca3619c4d2d88afe8ee3b25d4ba47ac799de51), [`d8e8e01`](https://github.com/tailor-platform/sdk/commit/d8e8e01fd64db947b370031dbf221ef79956f532), [`3153400`](https://github.com/tailor-platform/sdk/commit/3153400e27d8fefcdc6d7c0d0c5ab902f4bb73a3), [`2056a5c`](https://github.com/tailor-platform/sdk/commit/2056a5ca1ade011b25cc2da26af6d7ff45c05fdb), [`bbab2c0`](https://github.com/tailor-platform/sdk/commit/bbab2c0c769cb9c4b73b7a1cbf3618dbd2806bab), [`8fd3176`](https://github.com/tailor-platform/sdk/commit/8fd31765e47981aa77eb36dff23f5c448241cb18), [`b5a0d70`](https://github.com/tailor-platform/sdk/commit/b5a0d70f8e29d58f77809ef2514be9065e0a954f), [`519d137`](https://github.com/tailor-platform/sdk/commit/519d137ce3b172621e0149299966f30d9336c944), [`f1ec5b5`](https://github.com/tailor-platform/sdk/commit/f1ec5b5fbedce73d217830e2c6ac4a243b830a2d), [`bf11bf8`](https://github.com/tailor-platform/sdk/commit/bf11bf8d3bad6195c86ed289c764490dc6d680ee), [`a3bd9fb`](https://github.com/tailor-platform/sdk/commit/a3bd9fb1c22d7062c8627c80ebc5ebb3b1db0dc3), [`6a714b5`](https://github.com/tailor-platform/sdk/commit/6a714b50288bb22e60dd4f99a5632731b67e49fd), [`0328d54`](https://github.com/tailor-platform/sdk/commit/0328d54f76f8d5cfdb34492cd78b5c3ef9e97a00), [`3e6d582`](https://github.com/tailor-platform/sdk/commit/3e6d582a37d83a42302339cc4aea1d3dd11e8a81), [`2056a5c`](https://github.com/tailor-platform/sdk/commit/2056a5ca1ade011b25cc2da26af6d7ff45c05fdb), [`eeb235d`](https://github.com/tailor-platform/sdk/commit/eeb235debe910c05f755f036486878e7c763cb7e), [`d05a66c`](https://github.com/tailor-platform/sdk/commit/d05a66c65b2f0ed676d0b9c6ec3954e9abd48cd5), [`93b68ac`](https://github.com/tailor-platform/sdk/commit/93b68ace83dcb0af2a8b0afa8aa3336cb18c818b), [`3fb954e`](https://github.com/tailor-platform/sdk/commit/3fb954e12d505a7f0359e08df59080b5294b23cd), [`93b68ac`](https://github.com/tailor-platform/sdk/commit/93b68ace83dcb0af2a8b0afa8aa3336cb18c818b)]:
  - @tailor-platform/sdk@2.0.0

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
