---
"@tailor-platform/sdk": patch
---

Restructure TailorDB migration documentation. The migration concepts, configuration, supported schema changes, automatic execution flow, and troubleshooting have moved from the CLI reference (`docs/cli/tailordb.md`) into a dedicated guide (`docs/services/tailordb-migration.md`). The CLI reference now keeps only the command tables and links to the guide. The guide also adds previously missing operational guidance: exact `migration set` semantics (label-only, not a DB rollback), team workflow and CI/CD coordination, failure recovery, machine user permissions, multi-namespace ordering, performance for large tables, local testing, rollback strategy, observability, and a beta notice. Minor wording corrections for the pre-migration phase and foreign key change classification.
