---
"@tailor-platform/sdk": minor
---

`tailor executor trigger --header` and `triggerExecutor` now deliver headers to an incoming-webhook executor as its `headers`. Before, the values were not passed on and the executor received empty `headers`, and the command warned when `--header` was given; the warning is gone. `--header` lower-cases header names: a header given once reaches the executor as a string, and a header given more than once (names that differ only in letter case are the same header) as an array of strings, as when a request sends it on more than one line. `triggerExecutor` takes a `headers` option for incoming-webhook executors, and a type error rejects it for other executors. It sends each name as given, with a string or an array of strings as the value, and rejects two keys that differ only in letter case. A manual trigger still delivers no `rawBody`, so test an executor that verifies a signature over `rawBody` through its webhook URL.
