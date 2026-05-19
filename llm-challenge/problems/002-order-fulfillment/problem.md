# Order Fulfillment Domain

Build a small e-commerce order fulfillment domain using the `@tailor-platform/sdk` TailorDB DSL.

## Goal

Define four related models (`Customer`, `Order`, `OrderItem`, `Shipment`) that together model a customer placing an order containing line items, with shipments dispatched against the order.

## Domain Context

- A **Customer** has an email (the system's logical identity) and optional loyalty tier.
- An **Order** belongs to one customer, has a human-readable code, a workflow status, and a total amount.
- An **OrderItem** belongs to one order and represents one SKU at a unit price and quantity.
- A **Shipment** belongs to one order and is tracked by a unique tracking number.

## What to Build

Implement the following files. Each model file exports a named constant matching the lowerCamelCase model name (`customer`, `order`, `orderItem`, `shipment`).

### `tailordb/customer.ts`

Export: `customer` (named)

| Field               | Kind   | Options                                          |
| ------------------- | ------ | ------------------------------------------------ |
| email               | string | required, unique                                 |
| displayName         | string | required                                         |
| loyaltyTier         | enum   | values: `["BRONZE", "SILVER", "GOLD"]`, optional |
| createdAt/updatedAt |        | standard timestamp fields                        |

Field-level behavior:

- `email.create` hook: normalize value to lowercase. Treat non-string input as empty string.
- `loyaltyTier.create` hook: default to `"BRONZE"` when `value` is nullish; otherwise preserve.
- `email.validate`: accept only well-formed addresses (must contain `@` and a domain with a dot). Reject otherwise with message `"email must be a valid address"`.
- `displayName.validate`: must be a string of length ≤ 80. Reject otherwise with message `"displayName must be 80 characters or fewer"`.

### `tailordb/order.ts`

Export: `order` (named)

| Field               | Kind   | Options                                                        |
| ------------------- | ------ | -------------------------------------------------------------- |
| customerId          | uuid   | relation: n-1 toward Customer                                  |
| status              | enum   | values: `["PLACED", "PAID", "SHIPPED", "CANCELLED"]`, optional |
| orderCode           | string | serial: start 1, 5-digit zero-padded, prefix `ORD-`            |
| totalAmount         | float  | required                                                       |
| createdAt/updatedAt |        | standard timestamp fields                                      |

Field-level behavior:

- `status.create` hook: default to `"PLACED"` when `value` is nullish.
- `totalAmount.validate`: reject negative values with message `"totalAmount must be non-negative"`.

### `tailordb/orderItem.ts`

Export: `orderItem` (named)

| Field               | Kind   | Options                    |
| ------------------- | ------ | -------------------------- |
| orderId             | uuid   | relation: n-1 toward Order |
| sku                 | string | required                   |
| unitPrice           | float  | required                   |
| quantity            | int    | required                   |
| createdAt/updatedAt |        | standard timestamp fields  |

Field-level behavior:

- `quantity.validate`: reject `value <= 0` with message `"quantity must be positive"`.
- `unitPrice.validate`: reject `value < 0` with message `"unitPrice must be non-negative"`.

Both validators must be present so that a record with `quantity = 0` and `unitPrice = -1` is rejected by both.

### `tailordb/shipment.ts`

Export: `shipment` (named)

| Field               | Kind     | Options                    |
| ------------------- | -------- | -------------------------- |
| orderId             | uuid     | relation: n-1 toward Order |
| trackingNumber      | string   | required, unique           |
| shippedAt           | datetime | required                   |
| createdAt/updatedAt |          | standard timestamp fields  |

Type-level options:

- `permission`: `_loggedIn` users may `create`, `read`, `update`, `delete`.

### `tailor.config.ts`

A minimal config named `"order-fulfillment"` that registers all type files under `./tailordb/*.ts`.

## Reference

Refer to the installed `@tailor-platform/sdk` package for the model builder API, field DSL (`db.string`, `db.uuid`, `db.float`, `db.int`, `db.enum`, `db.datetime`, `db.fields.timestamps`), relation form, `serial` configuration, field-level `hooks` and `validate` shape, and record-level `permission` syntax.
