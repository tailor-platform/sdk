---
"@tailor-platform/sdk": patch
---

`tailor deploy` now warns when an IdP `permission` rule allows every authenticated user (a condition on `_loggedIn`, such as `[{ user: "_loggedIn" }, "=", true]`, as its only condition). Such a rule lets any signed-in user run that operation against any IdP user, for example reading and changing login information such as email addresses or sending password reset emails to anyone. The deploy still succeeds; restrict the rule to an administrator role unless every user who can sign in is trusted.
