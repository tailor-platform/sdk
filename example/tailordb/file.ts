import { db } from "@tailor-platform/sdk";

// NOTE: field-level `.validate()` has been removed from the public API.
// Nested object sub-fields can no longer carry inline validators; enforce
// constraints at the record level on the enclosing type via
// `db.type(...).validate(...)` instead.
export const attachedFiles = db.object(
  {
    id: db.uuid(),
    name: db.string(),
    size: db.int(),
    type: db.enum(["text", "image"]),
  },
  { array: true },
);
