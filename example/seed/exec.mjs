import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, styleText } from "node:util";
import { createInterface } from "node:readline";
import {
  show,
  getMachineUserToken,
  truncate,
  bundleSeedScript,
  chunkSeedData,
  executeScript,
  initOperatorClient,
  loadAccessToken,
  loadWorkspaceId,
} from "@tailor-platform/sdk/cli";

// Parse command-line arguments
const { values, positionals } = parseArgs({
  options: {
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
  console.log(`
Usage: node exec.mjs [options] [types...]

Options:
  -n, --namespace <ns> Process all types in specified namespace (excludes _User)
  --skip-idp           Skip IdP user (_User) entity
  --truncate           Truncate tables before seeding
  --yes                Skip confirmation prompts (for truncate)
  -p, --profile <name> Workspace profile name
  -h, --help           Show help

Examples:
  node exec.mjs                                     # Process all types (default)
  node exec.mjs --namespace <namespace>             # Process tailordb namespace only (no _User)
  node exec.mjs User Order                          # Process specific types only
  node exec.mjs --skip-idp                          # Process all except _User
  node exec.mjs --truncate                          # Truncate all tables, then seed all
  node exec.mjs --truncate --yes                    # Truncate all tables without confirmation, then seed all
  node exec.mjs --truncate --namespace <namespace>  # Truncate tailordb, then seed tailordb
  node exec.mjs --truncate User Order               # Truncate User and Order, then seed them
  `);
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
const configPath = join(configDir, "../tailor.config.ts");

// Entity configuration
const namespaceEntities = {
  "tailordb": [
    "Customer",
    "Invoice",
    "NestedProfile",
    "PurchaseOrder",
    "SalesOrder",
    "SalesOrderCreated",
    "Selfie",
    "Supplier",
    "User",
    "UserLog",
    "UserSetting",
  ],
  "analyticsdb": [
    "Event",
  ]
};
const namespaceDeps = {
  "tailordb": {
    "Customer": [],
    "Invoice": ["SalesOrder"],
    "NestedProfile": [],
    "PurchaseOrder": ["Supplier"],
    "SalesOrder": ["Customer", "User"],
    "SalesOrderCreated": [],
    "Selfie": [],
    "Supplier": [],
    "User": [],
    "UserLog": ["User"],
    "UserSetting": ["User"]
  },
  "analyticsdb": {
    "Event": []
  }
};
const entities = Object.values(namespaceEntities).flat();
const hasIdpUser = true;

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
    console.error(styleText("red", `Error: No entities found in namespace "${namespace}"`));
    console.error(styleText("yellow", `Available namespaces: ${Object.keys(namespaceEntities).join(", ")}`));
    process.exit(1);
  }

  console.log(styleText("cyan", `Filtering by namespace: ${namespace}`));
  console.log(styleText("dim", `Entities: ${entitiesToProcess.join(", ")}`));
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
    console.error(styleText("red", `Error: The following types were not found: ${notFoundTypes.join(", ")}`));
    console.error(styleText("yellow", `Available types: ${allTypes.join(", ")}`));
    process.exit(1);
  }

  console.log(styleText("cyan", `Filtering by types: ${entitiesToProcess.join(", ")}`));
}

// Apply --skip-idp filter
if (skipIdp) {
  if (entitiesToProcess) {
    entitiesToProcess = entitiesToProcess.filter((entity) => entity !== "_User");
  } else {
    entitiesToProcess = entities.filter((entity) => entity !== "_User");
  }
}

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
    console.log(styleText("green", "Truncate completed."));
  } catch (error) {
    console.error(styleText("red", `Truncate failed: ${error.message}`));
    process.exit(1);
  }
}

console.log(styleText("cyan", "\nStarting seed data generation..."));
if (skipIdp) {
  console.log(styleText("dim", `  Skipping IdP user (_User)`));
}

// Get application info
const appInfo = await show({ configPath, profile: values.profile });
const endpoint = `${appInfo.url}/query`;
const authNamespace = appInfo.auth;

// Get machine user token
const tokenInfo = await getMachineUserToken({
  name: "manager-machine-user",
  configPath,
  profile: values.profile,
});

// Load seed data from JSONL files
const loadSeedData = (dataDir, typeNames) => {
  const data = {};
  for (const typeName of typeNames) {
    const jsonlPath = join(dataDir, `${typeName}.jsonl`);
    try {
      const content = readFileSync(jsonlPath, "utf-8").trim();
      if (content) {
        data[typeName] = content.split("\n").map((line) => JSON.parse(line));
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

// Initialize operator client (once for all namespaces)
const accessToken = await loadAccessToken({ profile: values.profile, useProfile: true });
const workspaceId = await loadWorkspaceId({ profile: values.profile });
const operatorClient = await initOperatorClient(accessToken);

// Seed TailorDB types via testExecScript
const seedViaTestExecScript = async (namespace, typesToSeed, deps) => {
  const dataDir = join(configDir, "data");
  const sortedTypes = topologicalSort(typesToSeed, deps);
  const data = loadSeedData(dataDir, sortedTypes);

  // Skip if no data
  const typesWithData = sortedTypes.filter((t) => data[t] && data[t].length > 0);
  if (typesWithData.length === 0) {
    console.log(styleText("dim", `  [${namespace}] No data to seed`));
    return { success: true, processed: {} };
  }

  console.log(styleText("cyan", `  [${namespace}] Seeding ${typesWithData.length} types via Kysely batch insert...`));

  // Bundle seed script
  const bundled = await bundleSeedScript(namespace, typesWithData);

  // Chunk seed data to fit within gRPC message size limits
  const chunks = chunkSeedData({
    data,
    order: sortedTypes,
    codeByteSize: new TextEncoder().encode(bundled.bundledCode).length,
  });

  if (chunks.length === 0) {
    console.log(styleText("dim", `  [${namespace}] No data to seed`));
    return { success: true, processed: {} };
  }

  if (chunks.length > 1) {
    console.log(styleText("dim", `    Split into ${chunks.length} chunks`));
  }

  const allProcessed = {};
  let hasError = false;
  const allErrors = [];

  for (const chunk of chunks) {
    if (chunks.length > 1) {
      console.log(styleText("dim", `    Chunk ${chunk.index + 1}/${chunk.total}: ${chunk.order.join(", ")}`));
    }

    // Execute seed script for this chunk
    const result = await executeScript({
      client: operatorClient,
      workspaceId,
      name: `seed-${namespace}.ts`,
      code: bundled.bundledCode,
      arg: JSON.stringify({ data: chunk.data, order: chunk.order }),
      invoker: {
        namespace: authNamespace,
        machineUserName: "manager-machine-user",
      },
    });

    // Parse result and display logs
    if (result.logs) {
      for (const line of result.logs.split("\n").filter(Boolean)) {
        console.log(styleText("dim", `    ${line}`));
      }
    }

    if (result.success) {
      let parsed;
      try {
        const parsedResult = JSON.parse(result.result || "{}");
        parsed = parsedResult && typeof parsedResult === "object" ? parsedResult : {};
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(styleText("red", `    ✗ Failed to parse seed result: ${message}`));
        hasError = true;
        allErrors.push(message);
        continue;
      }

      const processed = parsed.processed || {};
      for (const [type, count] of Object.entries(processed)) {
        allProcessed[type] = (allProcessed[type] || 0) + count;
        console.log(styleText("green", `    ✓ ${type}: ${count} rows inserted`));
      }

      if (!parsed.success) {
        const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
        const errorMessage =
          errors.length > 0 ? errors.join("\n") : "Seed script reported failure";
        console.error(styleText("red", `    ✗ Seed failed: ${errorMessage}`));
        hasError = true;
        allErrors.push(errorMessage);
      }
    } else {
      console.error(styleText("red", `    ✗ Seed failed: ${result.error}`));
      hasError = true;
      allErrors.push(result.error);
    }
  }

  if (hasError) {
    return { success: false, error: allErrors.join("\n") };
  }
  return { success: true, processed: allProcessed };
};

// Seed _User via GraphQL mutation
const seedIdpUser = async () => {
  console.log(styleText("cyan", "  Seeding _User via GraphQL mutation..."));
  const dataDir = join(configDir, "data");
  const data = loadSeedData(dataDir, ["_User"]);
  const rows = data["_User"] || [];
  if (rows.length === 0) {
    console.log(styleText("dim", "    No _User data to seed"));
    return { success: true };
  }
  console.log(styleText("dim", `    Processing _User...`));
  const mutation = `mutation CreateUser($input: _CreateUserInput!) { _createUser(input: $input) { id } }`;
  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenInfo.accessToken}` },
        body: JSON.stringify({ query: mutation, variables: { input: rows[i] } }),
      });
      const result = await response.json();
      if (result.errors) {
        failCount++;
        console.error(styleText("red", `    ✗ Row ${i} in _User failed: ${result.errors[0].message}`));
      } else {
        successCount++;
      }
    } catch (error) {
      failCount++;
      console.error(styleText("red", `    ✗ Row ${i} in _User failed: ${error.message}`));
    }
  }
  console.log(styleText("green", `    ✓ _User: ${successCount} rows processed`));
  if (failCount > 0) {
    console.error(styleText("red", `    ✗ _User: ${failCount} rows failed`));
  }
  return { success: failCount === 0 };
};

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

    // Filter types if specific types requested
    let typesToSeed = entitiesToProcess
      ? nsTypes.filter((t) => entitiesToProcess.includes(t))
      : nsTypes;

    if (typesToSeed.length === 0) continue;

    const result = await seedViaTestExecScript(namespace, typesToSeed, nsDeps);
    if (!result.success) {
      allSuccess = false;
    }
  }

  // Seed _User if included and not skipped
  const shouldSeedUser = !skipIdp && (!entitiesToProcess || entitiesToProcess.includes("_User"));
  if (hasIdpUser && shouldSeedUser) {
    const result = await seedIdpUser();
    if (!result.success) {
      allSuccess = false;
    }
  }

  if (allSuccess) {
    console.log(styleText("green", "\n✓ Seed data generation completed successfully"));
  } else {
    console.error(styleText("red", "\n✗ Seed data generation completed with errors"));
    process.exit(1);
  }
} catch (error) {
  console.error(styleText("red", `\n✗ Seed data generation failed: ${error.message}`));
  process.exit(1);
}
