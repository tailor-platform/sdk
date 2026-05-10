# TailorDB API Design

Build a small product catalog schema using the `@tailor-platform/sdk` TailorDB API.

The task intentionally includes near-miss API choices. Use `db.type()` and `db.*` field builders for TailorDB models. Do not use resolver `t.*` schemas, `createResolver`, or executor APIs.

## Product (`tailordb/product.ts`)

Export: `product` (named)

| Field               | Kind   | Options                                                        |
| ------------------- | ------ | -------------------------------------------------------------- |
| name                | string | required                                                       |
| slug                | string | required, unique, create hook lowercases the value             |
| price               | float  | validation: must be non-negative, message `price must be >= 0` |
| status              | enum   | values: `["DRAFT", "ACTIVE", "ARCHIVED"]`                      |
| tags                | string | array, optional                                                |
| createdAt/updatedAt |        | standard timestamp fields                                      |

Type-level options:

- description: any non-empty string
- hooks must use `db.type().hooks()`
- validation must use `db.type().validate()`

## Config (`tailor.config.ts`)

- name: `"product-catalog"`
- db.tailordb files: `["./tailordb/*.ts"]`
