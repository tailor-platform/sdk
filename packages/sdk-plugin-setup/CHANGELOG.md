# @tailor-platform/sdk-plugin-setup

## 0.2.2

### Patch Changes

- [#2229](https://github.com/tailor-platform/sdk/pull/2229) [`f13dbac`](https://github.com/tailor-platform/sdk/commit/f13dbacb0c13fddaed0fb7ea99e541237e8b1218) Thanks [@renovate](https://github.com/apps/renovate)! - Upgrade zod dependency to v4.5.4
- Updated dependencies [[`eff7f82`](https://github.com/tailor-platform/sdk/commit/eff7f82b0678de494eef1fede8d2946961fd0d58), [`fae1d2d`](https://github.com/tailor-platform/sdk/commit/fae1d2dbf3bf2c6f1adf889032ac398a3a716d6d), [`ba386f0`](https://github.com/tailor-platform/sdk/commit/ba386f01931c4c597a31ba3dd9116bafd2e2b2d5), [`03a3a39`](https://github.com/tailor-platform/sdk/commit/03a3a3982d0b82d5180f779da505294029c1d392), [`a305420`](https://github.com/tailor-platform/sdk/commit/a305420cf7dd7de0192b2e8ae6d5be26f8a4bc36), [`f13dbac`](https://github.com/tailor-platform/sdk/commit/f13dbacb0c13fddaed0fb7ea99e541237e8b1218), [`9f6c7da`](https://github.com/tailor-platform/sdk/commit/9f6c7dab03bca204e954ce1fa2a372925dcd4a9b), [`e648f59`](https://github.com/tailor-platform/sdk/commit/e648f59b2e823bcd9119373cd4135173accf3f36)]:
  - @tailor-platform/sdk@2.12.0

## 0.2.1

### Patch Changes

- [#2205](https://github.com/tailor-platform/sdk/pull/2205) [`1cff028`](https://github.com/tailor-platform/sdk/commit/1cff028c263be7b42e58e3dbc5278f444df802aa) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update @inquirer
- Updated dependencies [[`6bd5286`](https://github.com/tailor-platform/sdk/commit/6bd5286aa3ea1d3dc3b56c7eac3a17f7a64ba7df), [`bfb06bf`](https://github.com/tailor-platform/sdk/commit/bfb06bfda619f9312e33092d2dadfb5ca88594cd), [`1cff028`](https://github.com/tailor-platform/sdk/commit/1cff028c263be7b42e58e3dbc5278f444df802aa), [`ee2bd7d`](https://github.com/tailor-platform/sdk/commit/ee2bd7dcc9cf88be47c1a5bcbe3dca0d5122c13a)]:
  - @tailor-platform/sdk@2.9.0

## 0.2.0

### Minor Changes

- [#2168](https://github.com/tailor-platform/sdk/pull/2168) [`aef699b`](https://github.com/tailor-platform/sdk/commit/aef699b36f5b0957747f34a327b0e19f1e47ba3a) Thanks [@dqn](https://github.com/dqn)! - Move the `tailor setup` commands into the optional `@tailor-platform/sdk-plugin-setup` CLI plugin.
  
  `setup` generates GitHub repository automation, which not every project uses, but its workflow templates and its `@croct/json5-parser` / `json5` dependencies shipped with the SDK for everyone. Splitting it out follows the same CLI plugin mechanism as `tailor tailordb erd`.
  
  To keep using `tailor setup <command>`, install the plugin next to the SDK:
  
  ```bash
  npm install -D @tailor-platform/sdk-plugin-setup
  ```
  
  The commands, options, generated files, and the `.github/tailor.lock` format are unchanged.

### Patch Changes

- Updated dependencies [[`2f79d38`](https://github.com/tailor-platform/sdk/commit/2f79d38b55f47dd4b0854ebff6c86bc7b33c01ad), [`293a0c3`](https://github.com/tailor-platform/sdk/commit/293a0c35b10b40b9d61f781fcc5d8bc96f54301e), [`8f48d23`](https://github.com/tailor-platform/sdk/commit/8f48d2349b4e618aaad88691ff6b1540d6a09228), [`58bfd7f`](https://github.com/tailor-platform/sdk/commit/58bfd7f165ef3fb57faa76f2813cb7d903db5b2b), [`e36bc5d`](https://github.com/tailor-platform/sdk/commit/e36bc5de9e3d08e1ea291896a6937a4c0bb34118), [`1c1b989`](https://github.com/tailor-platform/sdk/commit/1c1b9899cb8bf99525b27c8b53dd99b0972d7648), [`dd5bf5a`](https://github.com/tailor-platform/sdk/commit/dd5bf5a2fe6599364d9e25de39dd1e1763b47f3a), [`fa17d16`](https://github.com/tailor-platform/sdk/commit/fa17d1675c38047e3f700cb66851588bab27f74f), [`07ac5d0`](https://github.com/tailor-platform/sdk/commit/07ac5d019a14143438bf1072fe2bf7a7e9f6980c), [`1aca9f2`](https://github.com/tailor-platform/sdk/commit/1aca9f283b19f6ca392c8f53d725d7375e580dc4), [`3535006`](https://github.com/tailor-platform/sdk/commit/35350069b4055ce5996b92b0a0a5d153be5ad0d9), [`f9bb880`](https://github.com/tailor-platform/sdk/commit/f9bb880eb8d7eb218c3d44cf2874f928cb4b1c2e), [`4090591`](https://github.com/tailor-platform/sdk/commit/409059124a4dda81312e1982ae17f0b6430238c5), [`aef699b`](https://github.com/tailor-platform/sdk/commit/aef699b36f5b0957747f34a327b0e19f1e47ba3a), [`4c74e1b`](https://github.com/tailor-platform/sdk/commit/4c74e1b00df35316779a02ab3ed8fd0c3bf63e69)]:
  - @tailor-platform/sdk@2.7.0
