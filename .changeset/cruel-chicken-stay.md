---
"@tailor-platform/sdk": minor
---

feat: add `query` command for SQL/GraphQL playground

- Add new CLI subcommand: `tailor-sdk query`
- Support query engines via `--engine sql | gql`
- Execute query string via `--query` (`-q`)
- `--namespace` (`-n`) is used only in SQL mode:
  - if config has a single namespace, it is resolved automatically
  - if config has multiple namespaces, `--namespace` is required
- GraphQL mode does not use `--namespace`

Usage examples:

- SQL:
  `tailor-sdk query --engine sql -n tailordb -q "SELECT * FROM User" -m admin-machine-user`
- GraphQL:
  `tailor-sdk query --engine gql -q "query { users { id name } }" -m admin-machine-user`
