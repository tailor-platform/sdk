---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": patch
---

Remove the deprecated `openDownloadStream` file streaming API. Use `downloadStream` for streamed file downloads.

The generated file utilities now emit `downloadFileStream`, which calls `downloadStream` and returns `FileDownloadStreamResponse`, instead of the removed `openFileDownloadStream` helper.
