---
"@tailor-platform/sdk": patch
---

Add `disableGqlOperations` option for IdP configuration

When set, specific GraphQL operations for IdP users can be disabled:

- `create`: Disables the \_createUser mutation
- `update`: Disables the \_updateUser mutation
- `delete`: Disables the \_deleteUser mutation
- `read`: Disables the \_users and \_user queries
- `sendPasswordResetEmail`: Disables the \_sendPasswordResetEmail mutation
