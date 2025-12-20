---
"@tailor-platform/sdk": patch
---

Improve Connect error messages in CLI

- Add `errorHandlingInterceptor` to enhance error messages from Connect protocol
- Error messages now include operation type, resource type, and request parameters
- Makes it easier to identify which resource caused validation errors

Before:

```
ERROR  [invalid_argument] validation error: namespace_name: value does not match regex pattern...
```

After:

```
ERROR  [invalid_argument] Failed to list tailor dbtypes: validation error: namespace_name: value does not match regex pattern...
Request: {
  "namespaceName": "db",
  ...
}
```
