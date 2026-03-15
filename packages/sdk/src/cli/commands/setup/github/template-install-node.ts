/**
 * The install-node composite action YAML.
 * Targets pnpm projects -- the SDK scaffolds with pnpm and generated projects use pnpm.
 */
export const installNodeYaml = `name: Install Node.js
description: Install pnpm, Node.js, and project dependencies

runs:
  using: composite
  steps:
    - name: Install pnpm
      uses: pnpm/action-setup@41ff72655975bd51cab0327fa583b6e92b6d3061 # v4.2.0
      with:
        version: 10

    - name: Setup Node.js
      uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0
      with:
        node-version: 22
        cache: pnpm

    - name: Install dependencies
      run: pnpm install --frozen-lockfile
      shell: bash
`;
