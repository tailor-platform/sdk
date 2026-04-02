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

| Option          | Alias | Description                                                                         | Required | Default |
| --------------- | ----- | ----------------------------------------------------------------------------------- | -------- | ------- |
| `--to <TO>`     | -     | Target SDK version to upgrade to. Defaults to the version declared in package.json. | No       | -       |
| `--dry-run`     | `-d`  | Preview changes without modifying files                                             | No       | `false` |
| `--path <PATH>` | -     | Project directory to upgrade                                                        | No       | `"."`   |

<!-- politty:command:upgrade:options:end -->

<!-- politty:command:upgrade:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:upgrade:global-options-link:end -->
