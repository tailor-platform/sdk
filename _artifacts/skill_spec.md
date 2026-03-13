# @tailor-platform/sdk — Skill Spec

TypeScript SDK for declaratively defining and deploying enterprise applications
on the Tailor Platform. Covers database schemas (TailorDB), GraphQL resolvers,
event-driven executors, workflow orchestration, authentication, and deployment
via CLI.

## Domains

| Domain                                | Description                                                        | Skills                                   |
| ------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| Project scaffolding and configuration | Setting up projects and wiring top-level application configuration | project-setup, configuration, quickstart |
| Data modeling                         | Defining TailorDB types and generating TypeScript types            | model-definition, code-generation        |
| Server-side logic                     | Business logic through resolvers, executors, and workflows         | resolver, executor, workflow             |
| Operations and deployment             | CLI for deployment, workspace management, and operations           | cli-operations                           |

## Skill Inventory

| Skill            | Type      | Domain         | What it covers                                                                              | Failure modes |
| ---------------- | --------- | -------------- | ------------------------------------------------------------------------------------------- | ------------- |
| project-setup    | lifecycle | project-config | create-sdk scaffolding, directory structure                                                 | 3             |
| configuration    | core      | project-config | defineConfig, defineAuth, defineIdp, defineStaticWebSite, definePlugins, external resources | 5             |
| model-definition | core      | data-modeling  | db.type(), fields, relations, permissions, hooks, validation, indexes                       | 8             |
| code-generation  | core      | data-modeling  | Kysely type plugin, enum constants, file utils, seed, getDB()                               | 4             |
| resolver         | core      | server-logic   | createResolver, t type builder, input/output schemas, DB access                             | 3             |
| executor         | core      | server-logic   | createExecutor, triggers (record/schedule/webhook/resolver/auth/idp), operations            | 4             |
| workflow         | core      | server-logic   | createWorkflow, createWorkflowJob, .trigger(), retry policies                               | 6             |
| cli-operations   | core      | operations     | tailor-sdk CLI commands (apply, generate, workspace, migration, workflow, secrets)          | 3             |
| quickstart       | lifecycle | project-config | End-to-end from project creation to first deployment                                        | 3             |

## Failure Mode Inventory

### project-setup (3 failure modes)

| #   | Mistake                                 | Priority | Source             | Cross-skill? |
| --- | --------------------------------------- | -------- | ------------------ | ------------ |
| 1   | Wrong Node.js version                   | HIGH     | docs/quickstart.md | —            |
| 2   | Missing template flag in create command | MEDIUM   | docs/quickstart.md | —            |
| 3   | Using npm instead of pnpm               | HIGH     | package.json       | —            |

### configuration (5 failure modes)

| #   | Mistake                                         | Priority | Source              | Cross-skill? |
| --- | ----------------------------------------------- | -------- | ------------------- | ------------ |
| 1   | Using defineGenerators instead of definePlugins | HIGH     | source (deprecated) | —            |
| 2   | Both userProfile and machineUserAttributes      | CRITICAL | source (auth)       | —            |
| 3   | Hardcoding static website URL in CORS           | HIGH     | docs/staticwebsite  | —            |
| 4   | Forgetting test file ignore patterns            | MEDIUM   | docs/configuration  | —            |
| 5   | Missing usernameField unique constraint         | CRITICAL | docs/auth           | —            |

### model-definition (8 failure modes)

| #   | Mistake                                                | Priority | Source                      | Cross-skill? |
| --- | ------------------------------------------------------ | -------- | --------------------------- | ------------ |
| 1   | record/newRecord/oldRecord in gqlPermission            | CRITICAL | docs/tailordb, parser tests | —            |
| 2   | .index()/.unique() on array fields                     | HIGH     | source (schema.ts)          | —            |
| 3   | Mixing field-level and type-level hooks                | HIGH     | docs/tailordb               | —            |
| 4   | Forgetting default-deny permission model               | CRITICAL | docs/tailordb               | —            |
| 5   | Defining id field manually                             | HIGH     | source (schema.ts)          | —            |
| 6   | .vector() on non-string or array fields                | MEDIUM   | source (schema.ts)          | —            |
| 7   | Using fluent .optional() instead of constructor option | CRITICAL | maintainer interview        | —            |
| 8   | Async/complex logic in condition/validate/hooks        | HIGH     | maintainer interview        | executor     |

### code-generation (4 failure modes)

| #   | Mistake                                               | Priority | Source                 | Cross-skill?       |
| --- | ----------------------------------------------------- | -------- | ---------------------- | ------------------ |
| 1   | Missing @tailor-platform/function-types devDependency | HIGH     | docs/generator/builtin | —                  |
| 2   | Importing getDB before running generate               | MEDIUM   | docs/workflow          | —                  |
| 3   | Wrong namespace name in getDB()                       | HIGH     | example code           | —                  |
| 4   | Using unsupported Kysely query features (WITH, CTE)   | HIGH     | maintainer interview   | resolver, workflow |

### resolver (3 failure modes)

| #   | Mistake                                      | Priority | Source        | Cross-skill? |
| --- | -------------------------------------------- | -------- | ------------- | ------------ |
| 1   | Not default-exporting the resolver           | CRITICAL | docs/resolver | —            |
| 2   | Using db field types instead of t            | HIGH     | docs/resolver | —            |
| 3   | Missing authInvoker when triggering workflow | HIGH     | example code  | workflow     |

### executor (4 failure modes)

| #   | Mistake                                            | Priority | Source                | Cross-skill? |
| --- | -------------------------------------------------- | -------- | --------------------- | ------------ |
| 1   | Not default-exporting the executor                 | CRITICAL | docs/executor         | —            |
| 2   | Function body that returns a value                 | MEDIUM   | source (operation.ts) | —            |
| 3   | Missing authInvoker in graphql/workflow operations | HIGH     | docs/executor         | —            |
| 4   | Accessing result on failed resolverExecutedTrigger | HIGH     | source (event.ts)     | —            |

### workflow (6 failure modes)

| #   | Mistake                                      | Priority | Source          | Cross-skill? |
| --- | -------------------------------------------- | -------- | --------------- | ------------ |
| 1   | Not default-exporting createWorkflow result  | CRITICAL | docs/workflow   | —            |
| 2   | Not named-exporting workflow jobs            | CRITICAL | docs/workflow   | —            |
| 3   | Duplicate job names across project           | HIGH     | docs/workflow   | —            |
| 4   | Using Date in job input                      | HIGH     | source (job.ts) | —            |
| 5   | Forgetting to await .trigger()               | HIGH     | docs/workflow   | —            |
| 6   | Using Promise.all for parallel job execution | HIGH     | docs/workflow   | —            |

### cli-operations (3 failure modes)

| #   | Mistake                                   | Priority | Source             | Cross-skill? |
| --- | ----------------------------------------- | -------- | ------------------ | ------------ |
| 1   | .trigger() calls in test-run mode         | HIGH     | docs/cli/function  | —            |
| 2   | Forgetting --workspace-id on first deploy | HIGH     | docs/cli-reference | —            |
| 3   | Skipping generate before apply            | MEDIUM   | docs/quickstart    | —            |

### quickstart (3 failure modes)

| #   | Mistake                                        | Priority | Source          | Cross-skill?     |
| --- | ---------------------------------------------- | -------- | --------------- | ---------------- |
| 1   | Deploying without workspace creation           | HIGH     | docs/quickstart | —                |
| 2   | Not setting permissions on first model         | HIGH     | docs/tailordb   | model-definition |
| 3   | Using insecure IdP authorization in production | CRITICAL | docs/idp        | configuration    |

## Tensions

| Tension                                             | Skills                               | Agent implication                                               |
| --------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| Default-deny security vs getting-started simplicity | quickstart <-> model-definition      | Agents skip permissions for speed or over-restrict for security |
| Type safety strictness vs rapid prototyping         | code-generation <-> workflow         | Agents import generated types before running generate           |
| Declarative config vs imperative logic              | configuration <-> resolver, executor | Agents mix config-level and runtime concerns                    |

## Cross-References

| From             | To               | Reason                                                        |
| ---------------- | ---------------- | ------------------------------------------------------------- |
| project-setup    | quickstart       | Quickstart extends setup with first config and deploy         |
| model-definition | code-generation  | Models feed into code generation                              |
| model-definition | configuration    | Auth userProfile references a TailorDB type                   |
| resolver         | workflow         | Resolvers commonly trigger workflows                          |
| resolver         | code-generation  | Resolvers use getDB() from generated Kysely types             |
| executor         | model-definition | Record triggers reference TailorDB types                      |
| executor         | resolver         | resolverExecutedTrigger connects executors to resolver events |
| workflow         | code-generation  | Workflows use getDB() from generated Kysely types             |
| cli-operations   | code-generation  | tailor-sdk generate produces files configured by plugins      |
| configuration    | cli-operations   | Config defines what CLI deploys                               |

## Subsystems & Reference Candidates

| Skill            | Subsystems | Reference candidates                                      |
| ---------------- | ---------- | --------------------------------------------------------- |
| model-definition | —          | Field types and modifiers, Permission condition operators |
| executor         | —          | Trigger types and event payloads                          |
| cli-operations   | —          | CLI commands and options                                  |

## Remaining Gaps

| Skill          | Question                                                                          | Status |
| -------------- | --------------------------------------------------------------------------------- | ------ |
| project-setup  | What templates are available for create-sdk besides hello-world?                  | open   |
| configuration  | What are the exact external resource reference patterns for multi-app DB sharing? | open   |
| cli-operations | What is the recommended CI/CD setup for preview and production environments?      | open   |
| quickstart     | What is the complete login flow before first deploy?                              | open   |

## Recommended Skill File Structure

- **Core skills:** configuration, model-definition, code-generation, resolver, executor, workflow, cli-operations
- **Lifecycle skills:** project-setup, quickstart
- **Framework skills:** none (framework-agnostic)
- **Composition skills:** none (Kysely integration covered within core skills)
- **Reference files:** model-definition (field types, permissions), executor (trigger types), cli-operations (command reference)

## Composition Opportunities

| Library                    | Integration points                                               | Composition skill needed?                               |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Kysely                     | getDB() for type-safe DB access in resolvers/executors/workflows | No — covered within resolver, executor, workflow skills |
| @tailor-platform/app-shell | Frontend integration                                             | No — handled by app-shell's own skills                  |
