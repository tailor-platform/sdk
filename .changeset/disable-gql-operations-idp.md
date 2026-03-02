---
"@tailor-platform/sdk": patch
---

Add `gqlOperations` option for IdP configuration

Configure which GraphQL operations are enabled for IdP users. All operations are enabled by default (set `false` to disable):

- `create`: Enable \_createUser mutation (default: true)
- `update`: Enable \_updateUser mutation (default: true)
- `delete`: Enable \_deleteUser mutation (default: true)
- `read`: Enable \_users and \_user queries (default: true)
- `sendPasswordResetEmail`: Enable \_sendPasswordResetEmail mutation (default: true)
