# Generators Template

Demonstrates all built-in generator plugins for the Tailor Platform SDK.

## Plugins

- **kyselyTypePlugin** - Generates Kysely type definitions for type-safe database queries
- **enumConstantsPlugin** - Generates enum constant objects from `db.enum()` fields
- **fileUtilsPlugin** - Generates file upload/download utility functions
- **seedPlugin** - Generates seed data templates and execution script

## Generated Files

- `src/generated/db.ts` - Kysely database types
- `src/generated/enums.ts` - Enum constants
- `src/generated/files.ts` - File operation utilities

## Getting Started

```bash
pnpm install
pnpm generate    # Regenerate all generated files
pnpm deploy
```

## Testing

```bash
pnpm test
```
