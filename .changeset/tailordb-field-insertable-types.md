---
"@tailor-platform/sdk": minor
---

Add `TailorDBColumns` / `TailorDBInsertable` / `TailorDBSelectable` / `TailorDBUpdateable` to `@tailor-platform/sdk/kysely`. They accept either a table (`typeof myTable`) or a bare field collection, so code that is generic over the fields can derive create/read/update inputs the same way the generated table types do: `.serial()` fields are never caller-supplied, `.default()` and `.hooks({ create })` fields may be omitted on create, optional fields stay optional, and `id` is generated. `IsReadOnlyDBField` and `IsAutoFilledDBField` are also exported from `@tailor-platform/sdk` for asking whether callers can never write a single field, or may omit it on create.

Supplying a value for a `.serial()` column now fails with the reason instead of `'<column>' does not exist in type ...`, which read as a typo:

```
Type 'string' is not assignable to type 'TypeLevelError<"assigned by .serial(); remove it from the input">'.
```

This applies to the tables `kyselyTypePlugin` generates as well, because it comes from `Serial`. A serial column is now an omittable key on `Insertable`/`Updateable` rather than an absent one, so `keyof Insertable<Table<"MyType">>` includes it, and copying a whole record into a create input (`{ ...row }`) now reports the serial column instead of silently dropping it. Assigning the same values as before still compiles, and passing `undefined` is equivalent to omitting the column.

`Insertable`, `Selectable` and `Updateable` from the generated `Namespace` also print as a flat object rather than an intersection, so assignability errors name the shape directly.

`TailorDBField` gains an optional third type parameter carrying a nested object's own fields, so `db.object({ at: db.datetime() })` keeps that shape through the builder chain. Without it a date or datetime nested in an object resolved to `string | Date` (or `string`) while the runtime hands back a `Date`. Writing `TailorDBField<Defined, Output>` still works.
