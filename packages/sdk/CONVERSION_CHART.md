# Tailor Platform SDK / Terraform / Cue Configuration Conversion Chart

This document provides a comprehensive comparison of how to configure Tailor Platform resources using the Tailor Platform SDK, Terraform, and Cue.

## Table of Contents

- [Overview](#overview)
- [Models (TailorDB Types)](#models-tailordb-types)
- [Field Types](#field-types)
- [Field Modifiers](#field-modifiers)
- [Relations](#relations)
- [Validation](#validation)
- [Hooks](#hooks)
- [Pipeline Resolvers](#pipeline-resolvers)
- [Executors](#executors)
- [Authentication](#authentication)
- [Application Configuration](#application-configuration)

## Overview

| Aspect              | SDK                     | Terraform   | Cue               |
| ------------------- | ----------------------- | ----------- | ----------------- |
| Language            | TypeScript              | HCL         | Cue               |
| Type Safety         | Full TypeScript support | Limited     | Schema validation |
| File Extension      | `.ts`                   | `.tf`       | `.cue`            |
| Configuration Style | Code-based              | Declarative | Data-oriented     |

## Models (TailorDB Types)

### Basic Model Definition

**SDK**

```typescript
import { db, t } from "@tailor-platform/sdk";

export const customer = db.type("Customer", {
  name: db.string(),
  email: db.string(),
  phone: db.string({ optional: true }),
  ...db.fields.timestamps(),
  // or
  // createdAt: db.datetime({ optional: true, assertNonNull: true })
  //   .hooks({ create: () => new Date() }),
  // updatedAt: db.datetime({ optional: true })
  //   .hooks({ update: () => new Date() }),
});

export type Customer = t.infer<typeof customer>;
```

**Terraform**

```hcl
resource "tailor_tailordb_type" "customer" {
  namespace = "tailordb"
  name      = "Customer"

  field {
    name     = "name"
    type     = "string"
    required = true
  }

  field {
    name     = "email"
    type     = "string"
    required = true
  }

  field {
    name     = "phone"
    type     = "string"
    required = false
  }

  timestamp_fields = true
}
```

**Cue**

```cue
{
  "Kind": "tailordb",
  "Namespace": "tailordb",
  "Types": [{
    "Name": "Customer",
    "Fields": {
      "name": {
        "Type": "string",
        "Required": true
      },
      "email": {
        "Type": "string",
        "Required": true
      },
      "phone": {
        "Type": "string",
        "Required": false
      },
      "createdAt": {
        "Type": "datetime",
        "Required": false,
        "Hooks": {
          "Create": {
            "Expr": "(() => (new Date()).toISOString())({ value: _value, data: _data, user })"
          }
        }
      },
      "updatedAt": {
        "Type": "datetime",
        "Required": false,
        "Hooks": {
          "Create": {
            "Expr": "(() => (new Date()).toISOString())({ value: _value, data: _data, user })"
          },
          "Update": {
            "Expr": "(() => (new Date()).toISOString())({ value: _value, data: _data, user })"
          }
        }
      }
    }
  }]
}
```

## Field Types

| SDK                 | Terraform                                       | Cue                                             |
| ------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `db.string()`       | `type = "string"`                               | `"Type": "string"`                              |
| `db.int()`          | `type = "int"`                                  | `"Type": "int"`                                 |
| `db.float()`        | `type = "float"`                                | `"Type": "float"`                               |
| `db.bool()`         | `type = "bool"`                                 | `"Type": "bool"`                                |
| `db.date()`         | `type = "date"`                                 | `"Type": "date"`                                |
| `db.datetime()`     | `type = "datetime"`                             | `"Type": "datetime"`                            |
| `db.uuid()`         | `type = "uuid"`                                 | `"Type": "uuid"`                                |
| `db.enum("A", "B")` | `type = "enum"` + `allowed_values = ["A", "B"]` | `"Type": "string", "AllowedValues": ["A", "B"]` |

## Field Modifiers

### Optional Fields

**SDK**

```typescript
field: db.string({ optional: true });
```

**Terraform**

```hcl
field {
  name     = "field"
  type     = "string"
  required = false
}
```

**Cue**

```cue
"field": {
  "Type": "string",
  "Required": false
}
```

### Unique Fields

**SDK**

```typescript
email: db.string().unique();
```

**Terraform**

```hcl
field {
  name   = "email"
  type   = "string"
  index  = true
  unique = true
}
```

**Cue**

```cue
"email": {
  "Type": "string",
  "Index": true,
  "Unique": true
}
```

### Indexed Fields

**SDK**

```typescript
productId: db.uuid().index();
```

**Terraform**

```hcl
field {
  name  = "productId"
  type  = "uuid"
  index = true
}
```

**Cue**

```cue
"productId": {
  "Type": "uuid",
  "Index": true
}
```

### Array Fields

**SDK**

```typescript
tags: db.string({ array: true });
```

**Terraform**

```hcl
field {
  name  = "tags"
  type  = "string"
  array = true
}
```

**Cue**

```cue
"tags": {
  "Type": "string",
  "Array": true
}
```

## Relations

### One-to-Many Relation

**SDK**

```typescript
customerId: db.uuid().relation({
  type: "n-1",
  toward: { type: customer },
  backward: "orders",
});
```

**Terraform**

```hcl
field {
  name = "customerId"
  type = "uuid"

  relation {
    type     = "one-to-many"
    to_type  = "Customer"
    backward = "orders"
  }
}
```

**Cue**

```cue
"customerId": {
  "Type": "uuid",
  "ForeignKey": true,
  "ForeignKeyType": "Customer",
  "ForeignKeyRelation": "n-1",
  "BackwardField": "orders"
}
```

## Validation

### Field Validation

**SDK**

```typescript
name: db.string().validate(
  ({ value }) => value.length > 5,
  ({ value }) => value.length < 100,
);
```

**Terraform**

```hcl
field {
  name = "name"
  type = "string"

  validation {
    expression    = "value.length > 5"
    error_message = "Name must be longer than 5 characters"
  }

  validation {
    expression    = "value.length < 100"
    error_message = "Name must be shorter than 100 characters"
  }
}
```

**Cue**

```cue
"name": {
  "Type": "string",
  "Validate": [
    {
      "Action": "deny",
      "ErrorMessage": "Name must be longer than 5 characters",
      "Script": {
        "Expr": "!(({value})=>value.length>5)({ value: _value, user })"
      }
    },
    {
      "Action": "deny",
      "ErrorMessage": "Name must be shorter than 100 characters",
      "Script": {
        "Expr": "!(({value})=>value.length<100)({ value: _value, user })"
      }
    }
  ]
}
```

## Hooks

### Create/Update Hooks

**SDK**

```typescript
fullAddress: db.string().hooks({
  create: ({ data }) => `${data.postalCode} ${data.address} ${data.city}`,
  update: ({ data }) => `${data.postalCode} ${data.address} ${data.city}`,
});
```

**Terraform**

```hcl
field {
  name = "fullAddress"
  type = "string"

  hook {
    type       = "create"
    expression = "`${data.postalCode} ${data.address} ${data.city}`"
  }

  hook {
    type       = "update"
    expression = "`${data.postalCode} ${data.address} ${data.city}`"
  }
}
```

**Cue**

```cue
"fullAddress": {
  "Type": "string",
  "Hooks": {
    "Create": {
      "Expr": "(({data})=>`${data.postalCode} ${data.address} ${data.city}`)({ value: _value, data: _data, user })"
    },
    "Update": {
      "Expr": "(({data})=>`${data.postalCode} ${data.address} ${data.city}`)({ value: _value, data: _data, user })"
    }
  }
}
```

## Pipeline Resolvers

### Query Resolver

**SDK**

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "getCustomer",
  operation: "query",
  input: { id: t.string() },
  body: async (context) => {
    const customer = { id: context.input.id, name: "John Doe" };
    return { customer };
  },
  output: t.object({
    customer: t.object({ id: t.string(), name: t.string() }),
  }),
});
```

**Terraform**

```hcl
resource "tailor_pipeline_resolver" "get_customer" {
  namespace = "my-pipeline"
  name      = "getCustomer"
  type      = "query"

  input_schema = jsonencode({
    type = "object"
    properties = {
      id = { type = "string" }
    }
  })

  step {
    name = "fetchCustomer"
    type = "function"
    code = <<EOF
async (context) => {
  return { id: context.input.id, name: "John Doe" };
}
EOF
  }

  returns = "{ customer: context.fetchCustomer }"
}
```

**Cue**

```cue
{
  "Kind": "pipeline",
  "Namespace": "my-pipeline",
  "Resolvers": [{
    "Name": "getCustomer",
    "Type": "query",
    "Input": {
      "id": "String!"
    },
    "Steps": [{
      "Name": "fetchCustomer",
      "Type": "function",
      "Script": {
        "Expr": "async (context) => { return { id: context.input.id, name: 'John Doe' }; }"
      }
    }],
    "Returns": {
      "customer": "context.fetchCustomer"
    }
  }]
}
```

## Executors

### Record Created Trigger

**SDK**

```typescript
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { customer } from "../tailordb/customer";

export default createExecutor({
  name: "send-welcome-email",
  description: "Send welcome email to new customers",
  trigger: recordCreatedTrigger({
    type: customer,
    condition: ({ newRecord }) => newRecord.email != null
  })
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      console.log(`Sending welcome email to ${newRecord.email}`);
    },
  }
});
```

**Terraform**

```hcl
resource "tailor_executor" "send_welcome_email" {
  name        = "send-welcome-email"
  description = "Send welcome email to new customers"

  trigger {
    type = "record_created"
    config = {
      type_name = "Customer"
      namespace = "tailordb"
      filter    = "newRecord.email != null"
    }
  }

  execution {
    type = "function"
    code = <<EOF
async ({ newRecord }) => {
  console.log(`Sending welcome email to ${newRecord.email}`);
}
EOF
  }
}
```

**Cue**

```cue
{
  "Kind": "executor",
  "Executors": [{
    "Name": "send-welcome-email",
    "Description": "Send welcome email to new customers",
    "Trigger": {
      "Type": "record_created",
      "Config": {
        "TypeName": "Customer",
        "Namespace": "tailordb",
        "Filter": {
          "Expr": "({ newRecord }) => newRecord.email != null"
        }
      }
    },
    "Execution": {
      "Type": "function",
      "Script": {
        "Expr": "async ({ newRecord }) => { console.log(`Sending welcome email to ${newRecord.email}`); }"
      }
    }
  }]
}
```

### Schedule Trigger

**SDK**

```typescript
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily-report",
  description: "Generate daily report",
  trigger: scheduleTrigger({ cron: "0 9 * * *" }), // Every day at 9 AM
  operation: {
    kind: "function",
    body: async ({ client }) => {
      const result = await client.exec("SELECT COUNT(*) FROM Customer");
      console.log(`Total customers: ${result[0].count}`);
    },
  },
});
```

**Terraform**

```hcl
resource "tailor_executor" "daily_report" {
  name        = "daily-report"
  description = "Generate daily report"

  trigger {
    type = "schedule"
    config = {
      cron = "0 9 * * *"
    }
  }

  execution {
    type = "function"
    code = <<EOF
async ({ client }) => {
  const result = await client.exec("SELECT COUNT(*) FROM Customer");
  console.log(`Total customers: ${result[0].count}`);
}
EOF
  }
}
```

**Cue**

```cue
{
  "Kind": "executor",
  "Executors": [{
    "Name": "daily-report",
    "Description": "Generate daily report",
    "Trigger": {
      "Type": "schedule",
      "Config": {
        "Cron": "0 9 * * *"
      }
    },
    "Execution": {
      "Type": "function",
      "Script": {
        "Expr": "async ({ client }) => { const result = await client.exec('SELECT COUNT(*) FROM Customer'); console.log(`Total customers: ${result[0].count}`); }"
      }
    }
  }]
}
```

## Authentication

### ID Provider Configuration

**SDK**

```typescript
const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  role: db.enum("ADMIN", "USER"),
  ...db.fields.timestamps(),
});
export default defineConfig({
  app: {
    "my-app": {
      auth: defineAuth("my-auth", {
        idProvider: {
          name: "sample",
          kind: "IDToken",
          clientID: "exampleco",
          providerURL: "https://exampleco-enterprises.auth0.com/",
        },
        userProfile: {
          type: user,
          usernameField: "email",
          attributes: { role: true },
        },
      }),
    },
  },
});
```

**Terraform**

```hcl
resource "tailor_auth" "my_auth" {
  namespace = "my-auth"

  id_provider_config {
    name = "sample"
    kind = "IDToken"

    config = {
      client_id    = "exampleco"
      provider_url = "https://exampleco-enterprises.auth0.com/"
    }
  }

  user_profile_provider = "TAILORDB"

  user_profile_provider_config = {
    kind               = "TAILORDB"
    namespace          = "tailordb"
    type               = "User"
    username_field     = "email"
    attributes_fields  = ["roles"]
  }
}
```

**Cue**

```cue
{
  "Kind": "auth",
  "Namespace": "my-auth",
  "IdProviderConfigs": [{
    "Name": "sample",
    "Config": {
      "Kind": "IDToken",
      "ClientID": "exampleco",
      "ProviderURL": "https://exampleco-enterprises.auth0.com/"
    }
  }],
  "UserProfileProvider": "TAILORDB",
  "UserProfileProviderConfig": {
    "Kind": "TAILORDB",
    "Namespace": "tailordb",
    "Type": "User",
    "UsernameField": "email",
    "AttributesFields": ["roles"]
  }
}
```

## Application Configuration

### Full Application Setup

**SDK**

```typescript
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-project",
  region: "asia-northeast",
  app: {
    "my-app": {
      db: {
        tailordb: { files: ["./src/tailordb/*.ts"] },
      },
      pipeline: {
        "my-pipeline": { files: ["./src/resolvers/**/*.ts"] },
      },
      auth: {
        namespace: "my-auth",
        // ... auth config
      },
    },
  },
  executor: { files: ["./src/executors/*.ts"] },
});
```

**Terraform**

```hcl
resource "tailor_application" "my_app" {
  name   = "my-app"
  region = "asia-northeast"

  subgraph {
    type = "auth"
    name = "my-auth"
  }

  subgraph {
    type = "tailordb"
    name = "tailordb"
  }

  subgraph {
    type = "pipeline"
    name = "my-pipeline"
  }

  auth {
    namespace              = "my-auth"
    id_provider_config_name = "sample"
  }
}
```

**Cue**

```cue
{
  "Apps": [{
    "Kind": "application",
    "Name": "my-app",
    "Auth": {
      "Namespace": "my-auth",
      "IdProviderConfigName": "sample"
    },
    "Subgraphs": [
      {
        "Type": "auth",
        "Name": "my-auth"
      },
      {
        "Type": "tailordb",
        "Name": "tailordb"
      },
      {
        "Type": "pipeline",
        "Name": "my-pipeline"
      }
    ]
  }],
  "Kind": "workspace"
}
```

## Key Differences

### 1. Development Experience

- **SDK**: Full TypeScript support with type inference, code completion, and compile-time checks
- **Terraform**: HCL syntax with limited type checking, better for infrastructure-focused teams
- **Cue**: JSON-like syntax with schema validation, suitable for configuration management

### 2. Code Reusability

- **SDK**: Can extract and reuse TypeScript functions, types, and patterns
- **Terraform**: Modules and locals for reusability
- **Cue**: Definitions and references for configuration reuse

### 3. Validation and Type Safety

- **SDK**: Compile-time TypeScript validation
- **Terraform**: Runtime validation with limited type checking
- **Cue**: Schema-based validation with constraints

### 4. Integration

- **SDK**: Direct integration with TypeScript ecosystem
- **Terraform**: Integrates with existing Terraform workflows
- **Cue**: Can be used with various configuration management tools

### 5. Learning Curve

- **SDK**: Easiest for TypeScript developers
- **Terraform**: Familiar to infrastructure engineers
- **Cue**: Requires learning Cue language concepts
