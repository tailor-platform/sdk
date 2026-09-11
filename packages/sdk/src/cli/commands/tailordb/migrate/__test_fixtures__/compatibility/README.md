# Migration compatibility fixtures

`v2/0000/schema.json` preserves selected Customer fields from the committed
`example/migrations/0000/schema.json`, generated on 2026-02-12 (commit
`71d943c29`). The expressions use the historical `{ value, data, user }`
arguments and boolean validators. Keep these expressions unchanged.

`v2/0001/diff.json` preserves the Customer name, city, and fullAddress changes
from `example/migrations/0002/diff.json` at commit `aacca086e`. Its format is
**1**, despite being newer than the format-2 baseline: before the format gate
was introduced, the writer's version constant had regressed. Its `before`
fields contain legacy expressions and its `after` fields contain a later
legacy variant using `invoker`. Format numbers alone cannot identify the
script contract.
