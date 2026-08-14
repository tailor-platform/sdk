---
"@tailor-platform/sdk": patch
---

Stop dumping the request payload in API error messages. Failed requests (including `tailor query` timeouts) previously printed the full request body, which could expose credentials such as machine user access tokens embedded in query arguments to terminal and CI logs. Error messages now carry only allowlisted identifiers (resource names, namespaces, and ids) so a failing resource can still be identified.
