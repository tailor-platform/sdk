<!-- politty:command:upgrade:heading:start -->

## upgrade

<!-- politty:command:upgrade:heading:end -->

<!-- politty:command:upgrade:description:start -->

Run codemods to upgrade your project to a newer SDK version.

<!-- politty:command:upgrade:description:end -->

<!-- politty:command:upgrade:usage:start -->

**Usage**

```
tailor-sdk upgrade [options]
```

<!-- politty:command:upgrade:usage:end -->

<!-- politty:command:upgrade:options:start -->

**Options**

| Option          | Alias | Description                                   | Required | Default |
| --------------- | ----- | --------------------------------------------- | -------- | ------- |
| `--from <FROM>` | -     | SDK version before the upgrade (e.g., 1.33.0) | Yes      | -       |
| `--dry-run`     | `-d`  | Preview changes without modifying files       | No       | `false` |
| `--path <PATH>` | -     | Project directory to upgrade                  | No       | `"."`   |

<!-- politty:command:upgrade:options:end -->

<!-- politty:command:upgrade:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:upgrade:global-options-link:end -->

### How It Works

The `upgrade` command runs codemods that automatically transform your project code for breaking changes between SDK versions. The target version (`--to`) is auto-detected from the installed `@tailor-platform/sdk` in `node_modules`.

**Typical workflow:**

1. Update your SDK packages to the new version (e.g., `pnpm update @tailor-platform/sdk`)
2. Run `tailor-sdk upgrade --from <old-version>` to apply codemods
3. Review changes and commit

Use `--dry-run` to preview what changes will be made before applying them.
