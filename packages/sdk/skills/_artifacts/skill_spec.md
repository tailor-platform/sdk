# @tailor-platform/sdk — Skill Spec

TypeScript SDK for building applications on the Tailor Platform. Provides type-safe database schema definitions, custom GraphQL resolvers, event-driven executors, workflow orchestration, and authentication configuration.

## Domains

| Domain           | Description                                                                  | Skills            |
| ---------------- | ---------------------------------------------------------------------------- | ----------------- |
| data-modeling    | Defining database schemas, fields, relations, hooks, validation, permissions | services/tailordb |
| business-logic   | Custom GraphQL endpoints with typed inputs, DB access, validation            | services/resolver |
| event-processing | Reacting to data changes, schedules, webhooks, resolver executions           | services/executor |
| orchestration    | Multi-step durable jobs with explicit dependencies                           | services/workflow |
| authentication   | Identity, access control, machine users, OAuth2                              | services/auth     |
| extensibility    | Plugins for code generation, type augmentation, seed data                    | plugin            |
| quality          | Unit, integration, and E2E testing patterns                                  | testing           |

## Skill Inventory

| Skill             | Type | Domain           | What it covers                                                      | Failure modes |
| ----------------- | ---- | ---------------- | ------------------------------------------------------------------- | ------------- |
| services/tailordb | core | data-modeling    | db.type, fields, relations, hooks, validation, permissions, indexes | 8             |
| services/resolver | core | business-logic   | createResolver, input/output schemas, Kysely DB, validation         | 5             |
| services/executor | core | event-processing | createExecutor, 6 trigger types, 5 operation kinds, conditions      | 5             |
| services/workflow | core | orchestration    | createWorkflow, createWorkflowJob, trigger, export conventions      | 6             |
| services/auth     | core | authentication   | defineAuth, machineUsers, OAuth2, attributes, defineIdp             | 4             |
| plugin            | core | extensibility    | definePlugins, builtin plugins, custom Plugin interface, 5 hooks    | 4             |
| testing           | core | quality          | resolver/workflow mocks, DI pattern, E2E setup                      | 3             |

## Failure Mode Inventory

### services/tailordb (8 failure modes)

| #   | Mistake                                       | Priority | Source        | Cross-skill? |
| --- | --------------------------------------------- | -------- | ------------- | ------------ |
| 1   | mix field/type-level hooks on same field      | CRITICAL | docs + source | —            |
| 2   | mix field/type-level validation on same field | CRITICAL | docs + source | —            |
| 3   | omit permission — all operations blocked      | CRITICAL | docs          | auth         |
| 4   | manually define id field                      | HIGH     | source        | —            |
| 5   | .index()/.unique() on array field             | HIGH     | source        | —            |
| 6   | hooks on object/nested field                  | HIGH     | source        | —            |
| 7   | manually set publishEvents                    | MEDIUM   | docs          | executor     |
| 8   | unsafeAllowAll\*Permission in production      | CRITICAL | docs          | auth         |

### services/resolver (5 failure modes)

| #   | Mistake                             | Priority | Source  | Cross-skill? |
| --- | ----------------------------------- | -------- | ------- | ------------ |
| 1   | multiple resolvers in one file      | CRITICAL | docs    | —            |
| 2   | TailorDB options in resolver schema | HIGH     | docs    | tailordb     |
| 3   | wrong getDB namespace name          | HIGH     | runtime | —            |
| 4   | not default exported                | CRITICAL | docs    | —            |
| 5   | forget async/await with getDB       | MEDIUM   | pattern | —            |

### services/executor (5 failure modes)

| #   | Mistake                                         | Priority | Source | Cross-skill? |
| --- | ----------------------------------------------- | -------- | ------ | ------------ |
| 1   | name not globally unique                        | CRITICAL | docs   | —            |
| 2   | record trigger with publishEvents: false        | HIGH     | docs   | tailordb     |
| 3   | wrong secret reference syntax                   | HIGH     | docs   | —            |
| 4   | not narrowing success/error in resolver trigger | MEDIUM   | source | resolver     |
| 5   | invalid CRON expression                         | MEDIUM   | source | —            |

### services/workflow (6 failure modes)

| #   | Mistake                             | Priority | Source | Cross-skill? |
| --- | ----------------------------------- | -------- | ------ | ------------ |
| 1   | workflow not default exported       | CRITICAL | docs   | —            |
| 2   | job not named exported              | CRITICAL | docs   | —            |
| 3   | job name not globally unique        | CRITICAL | docs   | —            |
| 4   | Promise.all for parallel execution  | HIGH     | docs   | —            |
| 5   | Date/Map/Set as job input           | HIGH     | source | —            |
| 6   | Date→string in trigger return value | MEDIUM   | source | —            |

### services/auth (4 failure modes)

| #   | Mistake                                    | Priority | Source | Cross-skill? |
| --- | ------------------------------------------ | -------- | ------ | ------------ |
| 1   | both userProfile and machineUserAttributes | CRITICAL | source | —            |
| 2   | usernameField without unique constraint    | HIGH     | docs   | tailordb     |
| 3   | machine user missing required attributes   | HIGH     | docs   | —            |
| 4   | SDK/Platform attribute naming confusion    | MEDIUM   | docs   | —            |

### plugin (4 failure modes)

| #   | Mistake                                  | Priority | Source | Cross-skill? |
| --- | ---------------------------------------- | -------- | ------ | ------------ |
| 1   | wrong lifecycle hook order               | HIGH     | docs   | —            |
| 2   | confuse definition/generation-time hooks | HIGH     | docs   | —            |
| 3   | forget await on getGeneratedType()       | MEDIUM   | docs   | —            |
| 4   | missing declaration merging              | MEDIUM   | docs   | —            |

### testing (3 failure modes)

| #   | Mistake                                  | Priority | Source  | Cross-skill? |
| --- | ---------------------------------------- | -------- | ------- | ------------ |
| 1   | mock order doesn't match transaction seq | HIGH     | docs    | resolver     |
| 2   | forget WORKFLOW_TEST_ENV_KEY stub        | HIGH     | docs    | workflow     |
| 3   | token setup outside globalSetup          | MEDIUM   | example | —            |

## Tensions

| Tension                            | Skills              | Agent implication                                            |
| ---------------------------------- | ------------------- | ------------------------------------------------------------ |
| deny-by-default security vs speed  | tailordb ↔ auth     | Uses unsafeAllowAll\* then forgets to replace for production |
| type-safety vs rapid prototyping   | workflow ↔ resolver | Passes rich types that silently serialize to strings         |
| auto-detection vs explicit control | tailordb ↔ executor | Manually sets publishEvents conflicting with auto-detection  |

## Cross-References

| From     | To       | Reason                                                    |
| -------- | -------- | --------------------------------------------------------- |
| resolver | tailordb | Reuses field definitions via pickFields/omitFields        |
| executor | tailordb | Record triggers reference types; publishEvents dependency |
| executor | resolver | resolverExecutedTrigger references resolver output        |
| executor | workflow | Workflow operation triggers workflow with typed args      |
| workflow | auth     | authInvoker requires machine user from defineAuth         |
| resolver | workflow | Resolvers can trigger workflows and return workflowRunId  |
| testing  | resolver | Specific mock patterns for DB access                      |
| testing  | workflow | WORKFLOW_TEST_ENV_KEY stubbing and trigger mocking        |
| plugin   | tailordb | Plugins generate artifacts based on type definitions      |

## Recommended Skill File Structure

- **Core skills:** services/tailordb, services/resolver, services/executor, services/workflow, services/auth
- **Extension skills:** plugin
- **Quality skills:** testing
- **Reference files:** services/tailordb (dense API surface for field types, modifiers, permissions)

## Composition Opportunities

| Library                                   | Integration points          | Composition skill needed?                    |
| ----------------------------------------- | --------------------------- | -------------------------------------------- |
| Kysely                                    | getDB() in resolvers/jobs   | No — covered within resolver/workflow skills |
| @tailor-platform/function-kysely-tailordb | Kysely dialect for TailorDB | No — transparent dependency                  |
