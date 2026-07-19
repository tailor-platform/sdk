---
"@tailor-platform/sdk": patch
---

Fix IdP and TailorDB permission condition types breaking when `Attributes` fields are optional. Since machine user attribute keys started mirroring the source field's optionality, the `user` operand key helpers leaked `undefined` into their key unions — failing typecheck against the generated permission types even for `_loggedIn`-only conditions — and rejected attribute keys derived from optional fields. Optional attribute fields are now valid operand keys and `undefined` no longer appears in the unions.
