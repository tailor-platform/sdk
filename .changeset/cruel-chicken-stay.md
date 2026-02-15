---
"@tailor-platform/sdk": minor
---

feat: add `query` command for SQL/GraphQL playground

- Add new CLI subcommand: `tailor-sdk query`
- Support query engines via `--engine sql | gql`
- Execute queries against a namespace with `--namespace` (`-n`) and `--query` (`-q`)

Usage examples:

- SQL:
  `tailor-sdk query --engine sql -n tailordb -q "SELECT * FROM User" -m admin-machine-user`
- GraphQL:
  `tailor-sdk query --engine gql -n resolver -q "query { users { id name } }" -m admin-machine-user`
