---
"@tailor-platform/sdk": patch
---

TailorDB migration diffs, and the schema drift details `tailor function run` reports, now show foreign key changes on existing fields, such as `~ ownerId: foreignKey: User.id → Person.id`, instead of omitting them or printing `configuration changed`. In the schema drift details, a default value or create hook added to or removed from a field now shows as `optionalOnCreate: false → true` or `optionalOnCreate: true → false`.
