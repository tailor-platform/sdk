---
"@tailor-platform/sdk": patch
---

**Security**: Harden permissions of the CLI config file (`~/.config/tailor-platform/config.yaml`) and local crash reports to `0o600`, with their parent directory at `0o700`. Previously these files inherited the user's `umask` (typically `0o644`), so on multi-user hosts or shared CI volumes other accounts could read access/refresh tokens stored in the config when the OS keyring is unavailable, as well as crash payloads.

**Action recommended**: If you have used the CLI on a multi-user host or in a shared CI environment, upgrade and run any `tailor-sdk` command once to auto-tighten existing files, or manually:

```sh
chmod 700 ~/.config/tailor-platform
chmod 600 ~/.config/tailor-platform/config.yaml
```

POSIX-only; on Windows the mode bits are best-effort and ACLs continue to govern access.
