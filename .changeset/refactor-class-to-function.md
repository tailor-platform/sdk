---
"@tailor-platform/sdk": patch
---

Refactor class-based implementations to factory functions

- Convert service classes (AuthService, ExecutorService, ResolverService, TailorDBService) to factory functions
- Convert Application class to factory function
- Convert generator classes to factory functions
- Convert TailorField, TailorDBField, TailorDBType classes to interfaces with factory functions
- Introduce Symbol branding for reliable type identification
- Normalize undefined to null for optional fields
