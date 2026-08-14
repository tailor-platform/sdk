---
"@tailor-platform/sdk": patch
---

Stop dumping the request payload in API error messages. Failed requests (including `tailor query` timeouts) previously printed the full request body, which could expose credentials such as machine user access tokens embedded in query arguments to terminal and CI logs. Error messages now carry only non-sensitive resource identifiers (name-like fields such as the resource name and namespace) so a failing resource can still be identified.
