---
"@tailor-platform/sdk": patch
---

Fix workflow job test implementations to match descriptions

Updated two test cases in workflow job type tests to properly validate optional field handling:

- "allows multiple optional fields in input": now actually tests multiple optional fields in input parameters
- "allows nested objects with optional fields": now tests nested optional field structures in input parameters

This ensures test descriptions accurately reflect what is being tested.
