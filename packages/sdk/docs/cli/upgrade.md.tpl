---
politty:
  index:
    title: "Upgrade Commands"
    description: "Commands for upgrading SDK versions with automated code migration."
---

{{politty:command:upgrade:heading}}

{{politty:command:upgrade:description}}

{{politty:command:upgrade:usage}}

{{politty:command:upgrade:options}}

{{politty:command:upgrade:global-options-link}}

### How It Works

The `upgrade` command runs codemods that automatically transform your project code for breaking changes between SDK versions. The target version (`--to`) is auto-detected from the installed `@tailor-platform/sdk` in `node_modules`.

**Typical workflow:**

1. Update your SDK packages to the new version (e.g., `pnpm update @tailor-platform/sdk`)
2. Run `tailor-sdk upgrade --from <old-version>` to apply codemods
3. Review changes and commit

Use `--dry-run` to preview what changes will be made before applying them.
