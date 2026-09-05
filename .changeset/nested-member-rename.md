---
"@tailor-platform/sdk": minor
---

Detect renames of members inside nested fields in `tailordb migration generate`: a removed member with a compatible added sibling is confirmed interactively or with `--rename "Table.field.oldMember:newMember"` (`--drop "Table.field.member"` confirms a removal), recorded as a breaking `memberRenames` entry on the field's change, and given a generated copy script; the pre-migration phase keeps the old member readable and adds the new member as optional. Migration files now use format version 6, which older SDK versions refuse to read.
