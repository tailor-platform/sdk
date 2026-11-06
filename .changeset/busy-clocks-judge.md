---
"@tailor-platform/sdk": patch
---

`tailor executor trigger --data` now delivers the JSON to an incoming-webhook executor as its `body`, as a request to the webhook URL does. Since a Platform change, the data had arrived one level deeper, under `body.body`, so reading a field such as `body.email` returned `undefined` without an error. If an executor reads `body.body` to work around this, change it back to `body`. `--header` values are not passed to the executor, which receives empty `headers`, and the command now warns when `--header` is given. `--header` without `--data` no longer sends a body, so the executor receives `body` as `null`, as with no options. To test an executor that reads headers, send the request to its webhook URL, which `tailor executor webhook list` shows. The programmatic `triggerExecutor` passes `payload` to the executor as `body` unchanged, so pass the body itself rather than `{ body, headers }`.
