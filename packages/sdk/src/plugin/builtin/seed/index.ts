import * as path from "pathe";
import { assertDefined } from "@/utils/assert";
import ml from "@/utils/multiline";
import {
  processIdpUser,
  generateIdpUserSchemaFile,
  generateIdpSeedScriptCode,
  generateIdpTruncateScriptCode,
} from "./idp-user-processor";
import {
  processLinesDb,
  generateLinesDbSchemaFile,
  generateLinesDbSchemaFileWithPluginAPI,
  type PluginSchemaParams,
} from "./lines-db-processor";
import { processSeedTypeInfo } from "./seed-type-processor";
import type { Plugin } from "@/types/plugin";
import type { GeneratorResult, TailorDBReadyContext } from "@/types/plugin-generation";

/** Unique identifier for the seed generator plugin. */
export const SeedGeneratorID = "@tailor-platform/seed";

type DisableIdpUserSyncDirections = {
  /**
   * Skip emitting the foreign key from `<userProfile>.<usernameField>` to
   * `_User.name`. Defaults to `false` (FK emitted).
   *
   * Set to `true` to seed pre-registration states such as
   * invited-but-not-registered users.
   */
  userToIdp?: boolean;
  /**
   * Skip emitting the foreign key from `_User.name` to
   * `<userProfile>.<usernameField>`. Defaults to `false` (FK emitted).
   *
   * Set to `true` to seed `_User` rows that do not yet have a corresponding
   * userProfile row.
   */
  idpToUser?: boolean;
};

type SeedPluginOptions = {
  distPath: string;
  machineUserName?: string;
  /**
   * Disable individual `_User <-> userProfile` foreign keys emitted into
   * the generated seed schema. Both directions are emitted by default.
   *
   * Set a direction to `true` to relax it — for example to seed invited
   * users that do not yet have an IdP credential.
   */
  disableIdpUserSync?: DisableIdpUserSyncDirections;
};

function resolveIdpUserSyncFKs(option: SeedPluginOptions["disableIdpUserSync"]): {
  emitUserToIdpFK: boolean;
  emitIdpToUserFK: boolean;
} {
  return {
    emitUserToIdpFK: !(option?.userToIdp ?? false),
    emitIdpToUserFK: !(option?.idpToUser ?? false),
  };
}

type NamespaceConfig = {
  namespace: string;
  types: string[];
  dependencies: Record<string, string[]>;
  selfRefTypes: string[];
};

/**
 * Generate the IdP user seed function code using tailor.idp.Client via testExecScript
 * @param hasIdpUser - Whether IdP user is included
 * @param idpNamespace - The IDP namespace name
 * @returns JavaScript code for IdP user seeding function
 */
function generateIdpUserSeedFunction(hasIdpUser: boolean, idpNamespace: string | null): string {
  if (!hasIdpUser || !idpNamespace) return "";

  const scriptCode = generateIdpSeedScriptCode(idpNamespace);

  return ml`
    // Seed _User via tailor.idp.Client (server-side)
    const seedIdpUser = async () => {
      console.log(styleText("cyan", "  Seeding _User via tailor.idp.Client..."));
      const dataDir = join(configDir, "data");
      const data = loadSeedData(dataDir, ["_User"]);
      const rows = data["_User"] || [];
      if (rows.length === 0) {
        console.log(styleText("dim", "    No _User data to seed"));
        return { success: true };
      }
      console.log(styleText("dim", \`    Processing \${rows.length} _User records...\`));

      const idpSeedCode = \/* js *\/\`${scriptCode.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`;

      const result = await executeScript({
        client: operatorClient,
        workspaceId,
        name: "seed-idp-user.ts",
        code: idpSeedCode,
        arg: JSON.stringify({ users: rows }),
        invoker: {
          namespace: authNamespace,
          machineUserName,
        },
      });

      if (result.logs) {
        for (const line of result.logs.split("\\n").filter(Boolean)) {
          console.log(styleText("dim", \`    \${line}\`));
        }
      }

      if (result.success) {
        let parsed;
        try {
          parsed = JSON.parse(result.result || "{}");
        } catch (e) {
          console.error(styleText("red", \`    ✗ Failed to parse seed result: \${e.message}\`));
          return { success: false };
        }

        if (parsed.processed) {
          console.log(styleText("green", \`    ✓ _User: \${parsed.processed} rows processed\`));
        }

        if (!parsed.success) {
          const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
          for (const err of errors) {
            console.error(styleText("red", \`    ✗ \${err}\`));
          }
          return { success: false };
        }

        return { success: true };
      } else {
        console.error(styleText("red", \`    ✗ Seed failed: \${result.error}\`));
        return { success: false };
      }
    };
  `;
}

/**
 * Generate the IdP user seed call code
 * @param hasIdpUser - Whether IdP user is included
 * @returns JavaScript code for calling IdP user seeding
 */
function generateIdpUserSeedCall(hasIdpUser: boolean): string {
  if (!hasIdpUser) return "";

  return ml`
    // Seed _User if included and not skipped
    const shouldSeedUser = !skipIdp && (!entitiesToProcess || entitiesToProcess.includes("_User"));
    if (hasIdpUser && shouldSeedUser) {
      const result = await seedIdpUser();
      if (!result.success) {
        allSuccess = false;
      }
    }
  `;
}

/**
 * Generate the IdP user truncation function code using tailor.idp.Client via testExecScript
 * @param hasIdpUser - Whether IdP user is included
 * @param idpNamespace - The IDP namespace name
 * @returns JavaScript code for IdP user truncation function
 */
function generateIdpUserTruncateFunction(hasIdpUser: boolean, idpNamespace: string | null): string {
  if (!hasIdpUser || !idpNamespace) return "";

  const scriptCode = generateIdpTruncateScriptCode(idpNamespace);

  return ml`
    // Truncate _User via tailor.idp.Client (server-side)
    const truncateIdpUser = async () => {
      console.log(styleText("cyan", "Truncating _User via tailor.idp.Client..."));

      const idpTruncateCode = \/* js *\/\`${scriptCode.replace(/`/g, "\\`").replace(/\$/g, "\\$")}\`;

      const result = await executeScript({
        client: operatorClient,
        workspaceId,
        name: "truncate-idp-user.ts",
        code: idpTruncateCode,
        arg: JSON.stringify({}),
        invoker: {
          namespace: authNamespace,
          machineUserName,
        },
      });

      if (result.logs) {
        for (const line of result.logs.split("\\n").filter(Boolean)) {
          console.log(styleText("dim", \`  \${line}\`));
        }
      }

      if (result.success) {
        let parsed;
        try {
          parsed = JSON.parse(result.result || "{}");
        } catch (e) {
          console.error(styleText("red", \`  ✗ Failed to parse truncation result: \${e.message}\`));
          return { success: false };
        }

        if (parsed.deleted !== undefined) {
          console.log(styleText("green", \`  ✓ _User: \${parsed.deleted} users deleted\`));
        }

        if (!parsed.success) {
          const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
          for (const err of errors) {
            console.error(styleText("red", \`  ✗ \${err}\`));
          }
          return { success: false };
        }

        return { success: true };
      } else {
        console.error(styleText("red", \`  ✗ Truncation failed: \${result.error}\`));
        return { success: false };
      }
    };
  `;
}

/**
 * Generate the IdP user truncation call code within the truncate block
 * @param hasIdpUser - Whether IdP user is included
 * @returns JavaScript code for calling IdP user truncation
 */
function generateIdpUserTruncateCall(hasIdpUser: boolean): string {
  if (!hasIdpUser) return "";

  return ml`
    // Truncate _User if applicable
    const shouldTruncateUser = !skipIdp && !hasNamespace && (!hasTypes || entitiesToProcess.includes("_User"));
    if (hasIdpUser && shouldTruncateUser) {
      const truncResult = await truncateIdpUser();
      if (!truncResult.success) {
        console.error(styleText("red", "IDP user truncation failed."));
        process.exit(1);
      }
    }
  `;
}

/**
 * Generates the exec.mjs script content using testExecScript API for TailorDB types
 * and tailor.idp.Client for _User (IdP managed)
 * @param defaultMachineUserName - Default machine user name from generator config (can be overridden at runtime)
 * @param relativeConfigPath - Config path relative to exec script
 * @param namespaceConfigs - Namespace configurations with types and dependencies
 * @param hasIdpUser - Whether _User is included
 * @param idpNamespace - The IDP namespace name, or null if not applicable
 * @returns exec.mjs file contents
 */
function generateExecScript(
  defaultMachineUserName: string | undefined,
  relativeConfigPath: string,
  namespaceConfigs: NamespaceConfig[],
  hasIdpUser: boolean,
  idpNamespace: string | null,
): string {
  // Generate namespaceEntities object
  const namespaceEntitiesEntries = namespaceConfigs
    .map(({ namespace, types }) => {
      const entitiesFormatted = types.map((e) => `        "${e}",`).join("\n");
      return `      "${namespace}": [\n${entitiesFormatted}\n      ]`;
    })
    .join(",\n");

  // Generate dependency map for each namespace
  const namespaceDepsEntries = namespaceConfigs
    .map(({ namespace, dependencies }) => {
      const depsObj = Object.entries(dependencies)
        .map(([type, deps]) => `        "${type}": [${deps.map((d) => `"${d}"`).join(", ")}]`)
        .join(",\n");
      return `      "${namespace}": {\n${depsObj}\n      }`;
    })
    .join(",\n");

  // Generate self-referencing types map for each namespace
  const namespaceSelfRefEntries = namespaceConfigs
    .map(({ namespace, selfRefTypes }) => {
      const formatted = selfRefTypes.map((t) => `"${t}"`).join(", ");
      return `      "${namespace}": [${formatted}]`;
    })
    .join(",\n");

  return ml /* js */ `
    /**
     * @generated
     * This file is auto-generated by @tailor-platform/sdk's seedPlugin.
     * Do not edit by hand: changes will be overwritten on the next \`sdk generate\`.
     */
    import { readFileSync } from "node:fs";
    import { join, isAbsolute } from "node:path";
    import { parseArgs, styleText } from "node:util";
    import { createInterface } from "node:readline";
    import {
      show,
      truncate,
      bundleSeedScript,
      chunkSeedData,
      executeScript,
      initOperatorClient,
      loadAccessToken,
      loadWorkspaceId,
    } from "@tailor-platform/sdk/cli";

    // Handle "validate" subcommand before parseArgs
    const subcommand = process.argv[2];
    if (subcommand === "validate") {
      const { validateSeedData } = await import("@tailor-platform/sdk/seed");
      const validateArgs = parseArgs({
        args: process.argv.slice(3),
        options: {
          verbose: { type: "boolean", short: "v", default: false },
          help: { type: "boolean", short: "h", default: false },
        },
        allowPositionals: true,
      });

      if (validateArgs.values.help) {
        console.log(\`
    Usage: node exec.mjs validate [options] [path]

    Validate JSONL seed data against schema definitions.

    Arguments:
      path                      File or directory to validate (default: ./data)

    Options:
      -v, --verbose             Show verbose error output
      -h, --help                Show help

    Examples:
      node exec.mjs validate                  # Validate all seed data
      node exec.mjs validate ./data/User.jsonl # Validate specific file
      node exec.mjs validate -v               # Verbose error output
        \`);
        process.exit(0);
      }

      const configDir = import.meta.dirname;
      const targetPath = validateArgs.positionals[0] || join(configDir, "data");
      const resolvedPath = isAbsolute(targetPath) ? targetPath : join(process.cwd(), targetPath);

      try {
        const result = await validateSeedData({ path: resolvedPath, verbose: validateArgs.values.verbose });
        if (result.output) console.log(result.output);
        if (!result.valid) {
          console.error(result.error);
          process.exit(1);
        }
        process.exit(0);
      } catch (error) {
        console.error(styleText("red", \`Error: \${error instanceof Error ? error.message : String(error)}\`));
        process.exit(1);
      }
    }

    // Parse command-line arguments
    const { values, positionals } = parseArgs({
      options: {
        "machine-user": { type: "string", short: "m" },
        namespace: { type: "string", short: "n" },
        "skip-idp": { type: "boolean", default: false },
        truncate: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        profile: { type: "string", short: "p" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(\`
    Usage: node exec.mjs [command] [options] [types...]

    Commands:
      validate [path]           Validate seed data against schema (default: ./data)

    Options:
      -m, --machine-user <name> Machine user name for authentication (required if not configured)
      -n, --namespace <ns>      Process all types in specified namespace (excludes _User)
      --skip-idp                Skip IdP user (_User) entity
      --truncate                Truncate tables before seeding
      --yes                     Skip confirmation prompts (for truncate)
      -p, --profile <name>      Workspace profile name
      -h, --help                Show help

    Examples:
      node exec.mjs -m admin                            # Process all types with machine user
      node exec.mjs --namespace <namespace>             # Process tailordb namespace only (no _User)
      node exec.mjs User Order                          # Process specific types only
      node exec.mjs --skip-idp                          # Process all except _User
      node exec.mjs --truncate                          # Truncate all tables, then seed all
      node exec.mjs --truncate --yes                    # Truncate all tables without confirmation, then seed all
      node exec.mjs --truncate --namespace <namespace>  # Truncate tailordb, then seed tailordb
      node exec.mjs --truncate User Order               # Truncate User and Order, then seed them
      node exec.mjs validate                            # Validate all seed data
      node exec.mjs validate ./data/User.jsonl          # Validate specific file
      \`);
      process.exit(0);
    }

    // Helper function to prompt for y/n confirmation
    const promptConfirmation = (question) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      return new Promise((resolve) => {
        rl.question(styleText("yellow", question), (answer) => {
          rl.close();
          resolve(answer.toLowerCase().trim());
        });
      });
    };

    const configDir = import.meta.dirname;
    const configPath = join(configDir, "${relativeConfigPath}");

    // Determine machine user name (CLI argument takes precedence over config default)
    const defaultMachineUser = ${defaultMachineUserName ? `"${defaultMachineUserName}"` : "undefined"};
    const machineUserName = values["machine-user"] || defaultMachineUser;

    if (!machineUserName) {
      console.error(styleText("red", "Error: Machine user name is required."));
      console.error(styleText("yellow", "Specify --machine-user <name> or configure machineUserName in generator options."));
      process.exit(1);
    }

    // Entity configuration
    const namespaceEntities = {
${namespaceEntitiesEntries}
    };
    const namespaceDeps = {
${namespaceDepsEntries}
    };
    const namespaceSelfRefTypes = {
${namespaceSelfRefEntries}
    };
    const entities = Object.values(namespaceEntities).flat();
    const hasIdpUser = ${String(hasIdpUser)};

    // Determine which entities to process
    let entitiesToProcess = null;

    const hasNamespace = !!values.namespace;
    const hasTypes = positionals.length > 0;
    const skipIdp = values["skip-idp"];

    // Validate mutually exclusive options
    const optionCount = [hasNamespace, hasTypes].filter(Boolean).length;
    if (optionCount > 1) {
      console.error(styleText("red", "Error: Options --namespace and type names are mutually exclusive."));
      process.exit(1);
    }

    // --skip-idp and --namespace are redundant (namespace already excludes _User)
    if (skipIdp && hasNamespace) {
      console.warn(styleText("yellow", "Warning: --skip-idp is redundant with --namespace (namespace filtering already excludes _User)."));
    }

    // Filter by namespace (automatically excludes _User as it has no namespace)
    if (hasNamespace) {
      const namespace = values.namespace;
      entitiesToProcess = namespaceEntities[namespace];

      if (!entitiesToProcess || entitiesToProcess.length === 0) {
        console.error(styleText("red", \`Error: No entities found in namespace "\${namespace}"\`));
        console.error(styleText("yellow", \`Available namespaces: \${Object.keys(namespaceEntities).join(", ")}\`));
        process.exit(1);
      }

      console.log(styleText("cyan", \`Filtering by namespace: \${namespace}\`));
      console.log(styleText("dim", \`Entities: \${entitiesToProcess.join(", ")}\`));
    }

    // Filter by specific types
    if (hasTypes) {
      const requestedTypes = positionals;
      const notFoundTypes = [];
      const allTypes = hasIdpUser ? [...entities, "_User"] : entities;

      entitiesToProcess = requestedTypes.filter((type) => {
        if (!allTypes.includes(type)) {
          notFoundTypes.push(type);
          return false;
        }
        return true;
      });

      if (notFoundTypes.length > 0) {
        console.error(styleText("red", \`Error: The following types were not found: \${notFoundTypes.join(", ")}\`));
        console.error(styleText("yellow", \`Available types: \${allTypes.join(", ")}\`));
        process.exit(1);
      }

      console.log(styleText("cyan", \`Filtering by types: \${entitiesToProcess.join(", ")}\`));
    }

    // Apply --skip-idp filter
    if (skipIdp) {
      if (entitiesToProcess) {
        entitiesToProcess = entitiesToProcess.filter((entity) => entity !== "_User");
      } else {
        entitiesToProcess = entities.filter((entity) => entity !== "_User");
      }
    }

    // Get application info
    const appInfo = await show({ configPath, profile: values.profile });
    const authNamespace = appInfo.auth;

    // Initialize operator client (once for all namespaces)
    const accessToken = await loadAccessToken({ profile: values.profile, useProfile: true });
    const workspaceId = await loadWorkspaceId({ profile: values.profile });
    const operatorClient = await initOperatorClient(accessToken);

    ${generateIdpUserTruncateFunction(hasIdpUser, idpNamespace)}

    // Truncate tables if requested
    if (values.truncate) {
      const answer = values.yes ? "y" : await promptConfirmation("Are you sure you want to truncate? (y/n): ");
      if (answer !== "y") {
        console.log(styleText("yellow", "Truncate cancelled."));
        process.exit(0);
      }

      console.log(styleText("cyan", "Truncating tables..."));

      try {
        if (hasNamespace) {
          await truncate({
            configPath,
            profile: values.profile,
            namespace: values.namespace,
          });
        } else if (hasTypes) {
          const typesToTruncate = entitiesToProcess.filter((t) => t !== "_User");
          if (typesToTruncate.length > 0) {
            await truncate({
              configPath,
              profile: values.profile,
              types: typesToTruncate,
            });
          } else {
            console.log(styleText("dim", "No TailorDB types to truncate (only _User was specified)."));
          }
        } else {
          await truncate({
            configPath,
            profile: values.profile,
            all: true,
          });
        }
      } catch (error) {
        console.error(styleText("red", \`Truncate failed: \${error.message}\`));
        process.exit(1);
      }

      ${generateIdpUserTruncateCall(hasIdpUser)}

      console.log(styleText("green", "Truncate completed."));
    }

    console.log(styleText("cyan", "\\nStarting seed data generation..."));
    if (skipIdp) {
      console.log(styleText("dim", \`  Skipping IdP user (_User)\`));
    }

    // Load seed data from JSONL files
    const loadSeedData = (dataDir, typeNames) => {
      const data = {};
      for (const typeName of typeNames) {
        const jsonlPath = join(dataDir, \`\${typeName}.jsonl\`);
        try {
          const content = readFileSync(jsonlPath, "utf-8").trim();
          if (content) {
            data[typeName] = content.split("\\n").map((line) => JSON.parse(line));
          } else {
            data[typeName] = [];
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            data[typeName] = [];
          } else {
            throw error;
          }
        }
      }
      return data;
    };

    // Topological sort for dependency order
    const topologicalSort = (types, deps) => {
      const visited = new Set();
      const result = [];

      const visit = (type) => {
        if (visited.has(type)) return;
        visited.add(type);
        const typeDeps = deps[type] || [];
        for (const dep of typeDeps) {
          if (types.includes(dep)) {
            visit(dep);
          }
        }
        result.push(type);
      };

      for (const type of types) {
        visit(type);
      }
      return result;
    };

    // Seed TailorDB types via testExecScript
    const seedViaTestExecScript = async (namespace, typesToSeed, deps, selfRefTypes) => {
      const dataDir = join(configDir, "data");
      const sortedTypes = topologicalSort(typesToSeed, deps);
      const data = loadSeedData(dataDir, sortedTypes);

      // Skip if no data
      const typesWithData = sortedTypes.filter((t) => data[t] && data[t].length > 0);
      if (typesWithData.length === 0) {
        console.log(styleText("dim", \`  [\${namespace}] No data to seed\`));
        return { success: true, processed: {} };
      }

      console.log(styleText("cyan", \`  [\${namespace}] Seeding \${typesWithData.length} types via Kysely batch insert...\`));

      // Bundle seed script
      const bundled = await bundleSeedScript(namespace, typesWithData);

      // Chunk seed data to fit within gRPC message size limits
      const chunks = chunkSeedData({
        data,
        order: sortedTypes,
        codeByteSize: new TextEncoder().encode(bundled.bundledCode).length,
      });

      if (chunks.length === 0) {
        console.log(styleText("dim", \`  [\${namespace}] No data to seed\`));
        return { success: true, processed: {} };
      }

      if (chunks.length > 1) {
        console.log(styleText("dim", \`    Split into \${chunks.length} chunks\`));
      }

      const allProcessed = {};
      let hasError = false;
      const allErrors = [];

      for (const chunk of chunks) {
        if (chunks.length > 1) {
          console.log(styleText("dim", \`    Chunk \${chunk.index + 1}/\${chunk.total}: \${chunk.order.join(", ")}\`));
        }

        // Execute seed script for this chunk
        const result = await executeScript({
          client: operatorClient,
          workspaceId,
          name: \`seed-\${namespace}.ts\`,
          code: bundled.bundledCode,
          arg: JSON.stringify({ data: chunk.data, order: chunk.order, selfRefTypes }),
          invoker: {
            namespace: authNamespace,
            machineUserName,
          },
        });

        // Parse result and display logs
        if (result.logs) {
          for (const line of result.logs.split("\\n").filter(Boolean)) {
            console.log(styleText("dim", \`    \${line}\`));
          }
        }

        if (result.success) {
          let parsed;
          try {
            const parsedResult = JSON.parse(result.result || "{}");
            parsed = parsedResult && typeof parsedResult === "object" ? parsedResult : {};
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(styleText("red", \`    ✗ Failed to parse seed result: \${message}\`));
            hasError = true;
            allErrors.push(message);
            continue;
          }

          const processed = parsed.processed || {};
          for (const [type, count] of Object.entries(processed)) {
            allProcessed[type] = (allProcessed[type] || 0) + count;
            console.log(styleText("green", \`    ✓ \${type}: \${count} rows inserted\`));
          }

          if (!parsed.success) {
            const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
            const errorMessage =
              errors.length > 0 ? errors.join("\\n        ") : "Seed script reported failure";
            console.error(styleText("red", \`    ✗ Seed failed:\\n        \${errorMessage}\`));
            hasError = true;
            allErrors.push(errorMessage);
          }
        } else {
          console.error(styleText("red", \`    ✗ Seed failed: \${result.error}\`));
          hasError = true;
          allErrors.push(result.error);
        }
      }

      if (hasError) {
        return { success: false, error: allErrors.join("\\n") };
      }
      return { success: true, processed: allProcessed };
    };

    ${generateIdpUserSeedFunction(hasIdpUser, idpNamespace)}

    // Main execution
    try {
      let allSuccess = true;

      // Determine which namespaces and types to process
      const namespacesToProcess = hasNamespace
        ? [values.namespace]
        : Object.keys(namespaceEntities);

      for (const namespace of namespacesToProcess) {
        const nsTypes = namespaceEntities[namespace] || [];
        const nsDeps = namespaceDeps[namespace] || {};
        const nsSelfRefTypes = namespaceSelfRefTypes[namespace] || [];

        // Filter types if specific types requested
        let typesToSeed = entitiesToProcess
          ? nsTypes.filter((t) => entitiesToProcess.includes(t))
          : nsTypes;

        if (typesToSeed.length === 0) continue;

        const result = await seedViaTestExecScript(namespace, typesToSeed, nsDeps, nsSelfRefTypes);
        if (!result.success) {
          allSuccess = false;
        }
      }

      ${generateIdpUserSeedCall(hasIdpUser)}

      if (allSuccess) {
        console.log(styleText("green", "\\n✓ Seed data generation completed successfully"));
      } else {
        console.error(styleText("red", "\\n✗ Seed data generation completed with errors"));
        process.exit(1);
      }
    } catch (error) {
      console.error(styleText("red", \`\\n✗ Seed data generation failed: \${error.message}\`));
      process.exit(1);
    }

    `;
}

/**
 * Plugin that generates seed data files with Kysely batch insert and tailor.idp.Client for _User.
 * @param options - Plugin options
 * @param options.distPath - Output directory path for generated seed files
 * @param options.machineUserName - Default machine user name for authentication
 * @param options.disableIdpUserSync - Skip emitting individual `_User <-> userProfile` foreign keys. Both directions are emitted by default; set a direction to `true` to relax that side.
 * @returns Plugin instance with onTailorDBReady hook
 */
export function seedPlugin(options: SeedPluginOptions): Plugin<unknown, SeedPluginOptions> {
  return {
    id: SeedGeneratorID,
    description: "Generates seed data files (Kysely batch insert + tailor.idp.Client for _User)",
    pluginConfig: options,

    async onTailorDBReady(ctx: TailorDBReadyContext<SeedPluginOptions>): Promise<GeneratorResult> {
      const files: GeneratorResult["files"] = [];
      const namespaceConfigs: NamespaceConfig[] = [];

      // Process IdP user early so we can add reverse FK to the user profile type
      const idpUser = ctx.auth ? (processIdpUser(ctx.auth) ?? null) : null;
      const hasIdpUser = idpUser !== null;
      const idpUserSyncFKs = resolveIdpUserSyncFKs(ctx.pluginConfig.disableIdpUserSync);

      for (const ns of ctx.tailordb) {
        const types: string[] = [];
        const dependencies: Record<string, string[]> = {};
        const selfRefTypes: string[] = [];

        for (const [typeName, type] of Object.entries(ns.types)) {
          const source = assertDefined(
            ns.sourceInfo.get(typeName),
            `source info missing for type: ${typeName}`,
          );
          const typeInfo = processSeedTypeInfo(type, ns.namespace);
          const linesDb = processLinesDb(type, source);

          // Add reverse FK from userProfile type to _User (opt-out via disableIdpUserSync.userToIdp: true)
          if (
            idpUserSyncFKs.emitUserToIdpFK &&
            idpUser &&
            typeName === idpUser.schema.userTypeName
          ) {
            linesDb.foreignKeys.push({
              column: idpUser.schema.usernameField,
              references: {
                table: "_User",
                column: "name",
              },
            });
          }

          types.push(typeInfo.name);
          dependencies[typeInfo.name] = typeInfo.dependencies;
          if (typeInfo.selfRefFields.length > 0) {
            selfRefTypes.push(typeInfo.name);
          }

          // Generate empty JSONL data file
          files.push({
            path: path.join(ctx.pluginConfig.distPath, typeInfo.dataFile),
            content: "",
            skipIfExists: true,
          });

          const schemaOutputPath = path.join(
            ctx.pluginConfig.distPath,
            "data",
            `${linesDb.typeName}.schema.ts`,
          );

          // Plugin-generated type: use getGeneratedType API
          if (linesDb.pluginSource && linesDb.pluginSource.pluginImportPath) {
            // Build original type import path
            let originalImportPath: string | undefined;
            if (linesDb.pluginSource.originalFilePath && linesDb.pluginSource.originalExportName) {
              const relativePath = path.relative(
                path.dirname(schemaOutputPath),
                linesDb.pluginSource.originalFilePath,
              );
              originalImportPath = relativePath.replace(/\.ts$/, "").startsWith(".")
                ? relativePath.replace(/\.ts$/, "")
                : `./${relativePath.replace(/\.ts$/, "")}`;
            }

            // Compute relative path from schema output to config file
            const configImportPath = path.relative(path.dirname(schemaOutputPath), ctx.configPath);

            const params: PluginSchemaParams = {
              configImportPath,
              originalImportPath,
            };

            const schemaContent = generateLinesDbSchemaFileWithPluginAPI(linesDb, params);

            files.push({
              path: schemaOutputPath,
              content: schemaContent,
            });
          } else {
            // User-defined type: import from source file
            const relativePath = path.relative(path.dirname(schemaOutputPath), linesDb.importPath);
            const typeImportPath = relativePath.replace(/\.ts$/, "").startsWith(".")
              ? relativePath.replace(/\.ts$/, "")
              : `./${relativePath.replace(/\.ts$/, "")}`;
            const schemaContent = generateLinesDbSchemaFile(linesDb, typeImportPath);

            files.push({
              path: schemaOutputPath,
              content: schemaContent,
            });
          }
        }

        namespaceConfigs.push({
          namespace: ns.namespace,
          types,
          dependencies,
          selfRefTypes,
        });
      }

      if (idpUser) {
        // Generate empty JSONL data file
        files.push({
          path: path.join(ctx.pluginConfig.distPath, idpUser.dataFile),
          content: "",
          skipIfExists: true,
        });

        // Generate schema file with foreign key (opt-out via disableIdpUserSync.idpToUser: true)
        files.push({
          path: path.join(ctx.pluginConfig.distPath, "data", `${idpUser.name}.schema.ts`),
          content: generateIdpUserSchemaFile({
            usernameField: idpUser.schema.usernameField,
            userTypeName: idpUser.schema.userTypeName,
            includeUserProfileFK: idpUserSyncFKs.emitIdpToUserFK,
          }),
        });
      }

      // Generate exec.mjs (machineUserName can be provided at runtime if not configured)
      const relativeConfigPath = path.relative(ctx.pluginConfig.distPath, ctx.configPath);
      files.push({
        path: path.join(ctx.pluginConfig.distPath, "exec.mjs"),
        content: generateExecScript(
          ctx.pluginConfig.machineUserName,
          relativeConfigPath,
          namespaceConfigs,
          hasIdpUser,
          idpUser?.idpNamespace ?? null,
        ),
      });

      return { files };
    },
  };
}
