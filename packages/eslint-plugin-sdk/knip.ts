import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  // @types/eslint supplies the `eslint` declarations for the peer range's
  // floor: ESLint bundles its own only from 9.10.0, while peerDependencies
  // still allow >=9.0.0. Nothing imports it directly.
  ignoreDependencies: ["@types/eslint"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
