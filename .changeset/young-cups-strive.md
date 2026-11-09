---
"@tailor-platform/sdk": patch
---

TailorDB migration diffs, and the schema drift details `tailor function run` reports, now show the same change details for a modified nested member as for a top-level field, such as `~ address: members: ~zip (required: false → true)`, instead of only its path.
