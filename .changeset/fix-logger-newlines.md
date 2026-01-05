---
"@tailor-platform/sdk": patch
---

refactor(cli): improve stdout/stderr separation following clig.dev guidelines

- Add custom reporters (`IconReporter`, `PlainReporter`) to prevent extra newlines in piped environments
- All log methods (`info`, `success`, `warn`, `error`, `log`, `debug`) now output to stderr
- Rename `logger.data()` to `logger.out()` for primary program output to stdout
- `logger.out()` now accepts strings in addition to objects for table output

This separation allows clean command composition where stdout carries data output and stderr handles all messaging.
