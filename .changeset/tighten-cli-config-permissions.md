---
"@tailor-platform/sdk": patch
---

Write the CLI config file (`~/.config/tailor-platform/config.yaml`) and local crash reports with mode `0o600`, and their parent directory with mode `0o700`. Previously these files inherited the user's `umask` (typically `0o644`), so on multi-user hosts or shared CI volumes other accounts could read access/refresh tokens and crash payloads. Existing world-readable files are tightened in place on the next write. POSIX-only; on Windows the mode bits are best-effort and ACLs continue to govern access.
