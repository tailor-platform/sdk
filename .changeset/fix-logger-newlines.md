---
"@tailor-platform/sdk": patch
---

fix(cli): prevent extra newlines in turbo-piped output by using custom consola reporters

- Add `IconReporter` for defaultLogger and streamLogger to maintain icons without extra newlines
- Add `PlainReporter` for plainLogger to output messages without prefix brackets or extra newlines
- Fixes issue where FancyReporter added `\n + line + \n` for badge-level logs in piped environments
