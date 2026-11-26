---
"@tailor-platform/sdk": patch
---

`.default("now")` on `db.date()` and `db.time()` fields now fills in the UTC date (`YYYY-MM-DD`) and UTC time (`HH:mm`) of the operation. Before, a record created without the field was stored with it empty, so reading a required field failed with `Cannot return null for non-nullable field`, and seed validation rejected a row that omitted the field. The next `tailor deploy` updates the tables that use it. Records created before then keep the empty value until you set the field on them: an update that leaves the field out does not fill it. A table-level create hook now receives these fields as strings, as their types declare, and `createTailorDBHook` and `tailor seed fill --fields` return and write these values in place of a full datetime.

Seed validation also accepts a row that omits a `db.datetime()` field with a fixed `Date` default, which it rejected as not an ISO datetime.
