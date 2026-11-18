---
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Provide the ERD viewer as the default tab of `tailor webui`.

The package now declares a `tailorUi` entry in its `package.json`. `tailor webui` mounts it under `/plugins/tailordb-erd/`, and every page load rebuilds the viewer for the first TailorDB namespace in a fresh process, so a reload shows edited definitions.
