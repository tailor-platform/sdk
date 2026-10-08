---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

`tailor setup ci preview` now cancels the whole superseded preview run, including the jobs you added with `needs: tailor-preview-deploy`, so they no longer keep running against a preview workspace that a newer run is redeploying or that closing the pull request deletes. Run `tailor setup update` to regenerate existing preview workflows; a top-level `concurrency:` you already set in one is kept in place of the new default.
