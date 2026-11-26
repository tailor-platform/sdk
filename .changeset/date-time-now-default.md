---
"@tailor-platform/sdk": patch
---

`.default("now")` on `db.date()` and `db.time()` fields now fills in the UTC date (`YYYY-MM-DD`) and UTC time (`HH:mm`) of the operation. Before, a record created without the field was stored with it empty, so reading a required field failed with `Cannot return null for non-nullable field`, and seed validation rejected a row that omitted the field. The next `tailor deploy` updates the tables that use it. Records created before then keep the empty value until you update them. A table-level create hook now receives these fields as strings, as their types declare, and `tailor seed fill` writes these values in place of a full datetime.
