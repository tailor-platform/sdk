# Completion

<!-- politty:command:completion:heading:start -->

## completion

<!-- politty:command:completion:heading:end -->

<!-- politty:command:completion:description:start -->

Generate shell completion script

<!-- politty:command:completion:description:end -->

<!-- politty:command:completion:usage:start -->

**Usage**

```
tailor-sdk completion [options] [shell]
```

<!-- politty:command:completion:usage:end -->

<!-- politty:command:completion:arguments:start -->

**Arguments**

| Argument | Description                     | Required |
| -------- | ------------------------------- | -------- |
| `shell`  | Shell type (bash, zsh, or fish) | No       |

<!-- politty:command:completion:arguments:end -->

<!-- politty:command:completion:options:start -->

**Options**

| Option           | Alias | Description                                                                                                                          | Required | Default |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------- |
| `--instructions` | `-i`  | Show installation instructions                                                                                                       | No       | `false` |
| `--loader`       | -     | Print just the rc loader snippet (bash/zsh). Add it to ~/.bashrc or ~/.zshrc; it auto-regenerates the cache when the binary changes. | No       | `false` |
| `--install`      | -     | Write the completion script to its on-disk cache (bash/zsh) or autoload location (fish) instead of printing it.                      | No       | `false` |
| `--static`       | -     | Generate the legacy static completion script with command metadata baked in.                                                         | No       | `false` |
| `--dispatcher`   | -     | Generate the runtime dispatcher completion script. This is the default.                                                              | No       | `false` |
| `--worker`       | -     | Generate an internal static worker artifact for dispatcher mode.                                                                     | No       | `false` |

<!-- politty:command:completion:options:end -->

<!-- politty:command:completion:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:completion:global-options-link:end -->
