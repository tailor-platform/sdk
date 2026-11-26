---
"@tailor-platform/sdk": patch
---

`.default("now")` on `db.date()` and `db.time()` fields now fills in the UTC date (`YYYY-MM-DD`) and UTC time (`HH:mm`) of the operation. Before, a record created without the field was stored with it empty, so reading a required field failed with `Cannot return null for non-nullable field`, and seed validation rejected a row that omitted the field. The next `tailor deploy` updates the tables that use it. Records created before then keep the empty value until you set the field on them: an update that leaves the field out does not fill it. A table-level create hook now receives these fields as strings, as their types declare, and `createTailorDBHook` and `tailor seed fill --fields` return and write these values in place of a full datetime.

Seed validation also accepts a row that omits a `db.datetime()` field with a fixed `Date` default, including a `Date` array on an array field, a row whose field create hook returns a `Date` array, and a row whose table create hook returns `Date`s inside an array or object. It rejected these as not ISO datetimes. `createTailorDBHook` now returns these `Date`s as ISO strings.
