---
"@tailor-platform/tailor-sdk": patch
---

Fixed the issue where relations couldn't be set to fields other than `id`

Fixed deployment errors caused by always trying to set foreign keys to `id`, and now foreign keys are set to the correct fields.
