# Inventory Management

This is a sample project for an inventory management system using [Tailor SDK](https://www.npmjs.com/package/@tailor-platform/tailor-sdk).

This project was bootstrapped with [Create Tailor SDK](https://www.npmjs.com/package/@tailor-platform/create-tailor-sdk).

## Usage

1. Create a new workspace:

```bash
npx tailor-sdk login
npx tailor-sdk workspace create --name <workspace-name> --region <workspace-region>
npx tailor-sdk workspace list
# For yarn: yarn tailor-sdk <command>
# For pnpm: pnpm tailor-sdk <command>

# OR
# Create a new workspace using Tailor Platform Console
# https://console.tailor.tech/
```

2. Deploy the project:

```bash
npm run deploy -- --workspace-id <your-workspace-id>
# For yarn: yarn run deploy --workspace-id <your-workspace-id>
# For pnpm: pnpm run deploy --workspace-id <your-workspace-id>
```

3. Open [Tailor Platform Console](https://console.tailor.tech/) and open GraphQL Playground.

4. Test GraphQL operations with machine user's token:

```bash
# Get Manager's token
npx tailor-sdk machineuser token inventory-management -m manager
# Get Staff's token
npx tailor-sdk machineuser token inventory-management -m staff
```

## Features

- Management of master data (e.g., User, Product, Category)
  - Only users with Manager role can operate
- Order creation
  - Inventory is updated simultaneously
- Inventory monitoring
  - Notifications are created when inventory falls below a certain threshold

## Scripts

In the project directory, you can run:

- `deploy`: Deploy the project to Tailor Platform
- `gen`: Generate TypeScript types
- `format`: Format the code using Prettier
- `format:check`: Check code formatting using Prettier
- `lint`: Lint the code using ESLint
- `lint:fix`: Fix linting issues using ESLint
- `typecheck`: Run TypeScript type checks

## Examples

The following are example GraphQL operations to test the inventory management system.

1. Create a category:

```graphql
mutation createCategory {
  createCategory(input: { name: "Furniture" }) {
    id
    name
  }
}
# {
#   "data": {
#     "createCategory": {
#       "id": "f7c9a16a-d69c-4570-a6b9-571f97f728fd",
#       "name": "Furniture"
#     }
#   }
# }
```

2. Create a product:

```graphql
mutation createProduct {
  createProduct(
    input: {
      name: "Ergonomic Office Chair"
      categoryId: "f7c9a16a-d69c-4570-a6b9-571f97f728fd"
    }
  ) {
    id
    name
  }
}
# {
#   "data": {
#     "createProduct": {
#       "id": "54ed76c5-30e5-4b36-a82f-3c03d6436323",
#       "name": "Ergonomic Office Chair"
#     }
#   }
# }
```

3. Create contacts:

```graphql
mutation createContact {
  a: createContact(input: { name: "John Doe", email: "john.doe@example.com" }) {
    id
    name
  }
  b: createContact(
    input: { name: "Jane Smith", email: "jane.smith@example.com" }
  ) {
    id
    name
  }
}
# {
#   "data": {
#     "a": {
#       "id": "82596a87-d0b0-47d6-8535-e70e4600c3c1",
#       "name": "John Doe"
#     },
#     "b": {
#       "id": "87cfb619-b6a5-4ad6-9b62-7de15b8bd5b9",
#       "name": "Jane Smith"
#     }
#   }
# }
```

4. Create orders:

```graphql
mutation registerOrder {
  a: registerOrder(
    input: {
      order: {
        name: "order-1"
        orderType: "PURCHASE"
        orderDate: "2025-09-01T00:00:00Z"
        contactId: "82596a87-d0b0-47d6-8535-e70e4600c3c1"
      }
      items: [
        {
          productId: "54ed76c5-30e5-4b36-a82f-3c03d6436323"
          unitPrice: 200
          quantity: 20
        }
      ]
    }
  ) {
    success
  }
  b: registerOrder(
    input: {
      order: {
        name: "order-2"
        orderType: "SALES"
        orderDate: "2025-10-01T00:00:00Z"
        contactId: "87cfb619-b6a5-4ad6-9b62-7de15b8bd5b9"
      }
      items: [
        {
          productId: "54ed76c5-30e5-4b36-a82f-3c03d6436323"
          unitPrice: 300
          quantity: 15
        }
      ]
    }
  ) {
    success
  }
}
# {
#   "data": {
#     "a": {
#       "success": true
#     },
#     "b": {
#       "success": true
#     }
#   }
# }
```

5. Check inventory:

```graphql
query inventories {
  inventories {
    edges {
      node {
        product {
          name
        }
        quantity
      }
    }
  }
  notifications {
    edges {
      node {
        message
      }
    }
  }
}
# {
#   "data": {
#     "inventories": {
#       "edges": [
#         {
#           "node": {
#             "product": {
#               "name": "Ergonomic Office Chair"
#             },
#             "quantity": 5
#           }
#         }
#       ]
#     },
#     "notifications": {
#       "edges": [
#         {
#           "node": {
#             "message": "Inventory for product 54ed76c5-30e5-4b36-a82f-3c03d6436323 is below threshold. Current quantity: 5"
#           }
#         }
#       ]
#     }
#   }
# }
```

Note:

- Replace IDs in the examples with the actual IDs returned from your operations.
- Ensure you use the appropriate token (Manager or Staff) for each operation.
