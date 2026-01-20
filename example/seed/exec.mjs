import { GQLIngest } from "@jackchuka/gql-ingest";
import { join } from "node:path";
import { parseArgs, styleText } from "node:util";
import { createInterface } from "node:readline";
import { show, getMachineUserToken, truncate } from "@tailor-platform/sdk/cli";

// Parse command-line arguments
const { values, positionals } = parseArgs({
  options: {
    namespace: { type: "string", short: "n" },
    "skip-idp": { type: "boolean", default: false },
    truncate: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
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

console.log(styleText("cyan", "Starting seed data generation..."));

// Entity configuration
const namespaceEntities = {
  tailordb: [
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
  analyticsdb: [
    "Event",
  ]
};

const entityDependencies = {
  "Customer": [],
  "Invoice": ["SalesOrder"],
  "NestedProfile": [],
  "PurchaseOrder": ["Supplier"],
  "SalesOrder": ["Customer"],
  "SalesOrderCreated": [],
  "Selfie": [],
  "Supplier": [],
  "User": [],
  "UserLog": ["User"],
  "UserSetting": ["User"],
  "Event": [],
  "_User": ["User"]
};

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
  console.error(styleText("red", "Error: --skip-idp is redundant with --namespace (namespace filtering already excludes _User)."));
  process.exit(1);
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

  entitiesToProcess = requestedTypes.filter((type) => {
    if (!(type in entityDependencies)) {
      notFoundTypes.push(type);
      return false;
    }
    return true;
  });

  if (notFoundTypes.length > 0) {
    console.error(styleText("red", `Error: The following types were not found: ${notFoundTypes.join(", ")}`));
    console.error(styleText("yellow", `Available types: ${Object.keys(entityDependencies).join(", ")}`));
    process.exit(1);
  }

  console.log(styleText("cyan", `Filtering by types: ${entitiesToProcess.join(", ")}`));
}

// Apply --skip-idp filter
if (skipIdp) {
  if (entitiesToProcess) {
    // Filter out _User from already filtered list
    entitiesToProcess = entitiesToProcess.filter((entity) => entity !== "_User");
  } else {
    // Get all entities except _User
    entitiesToProcess = Object.keys(entityDependencies).filter((entity) => entity !== "_User");
  }
  console.log(styleText("dim", `Skipping IdP user (_User)`));
}

// Truncate tables if requested
// Note: --skip-idp only affects seeding, not truncation
if (values.truncate) {
  // Prompt user for confirmation
  const answer = values.yes ? "y" : await promptConfirmation("Are you sure you want to truncate? (y/n): ");
  if (answer !== "y") {
    console.log(styleText("yellow", "Truncate cancelled."));
    process.exit(0);
  }

  console.log(styleText("cyan", "\nTruncating tables..."));

  try {
    if (hasNamespace) {
      // Truncate specific namespace
      await truncate({
        configPath,
        namespace: values.namespace,
        yes: true,
      });
    } else if (hasTypes) {
      // Truncate specific types
      await truncate({
        configPath,
        types: entitiesToProcess || positionals,
        yes: true,
      });
    } else {
      // Truncate all (--skip-idp does not affect truncation)
      await truncate({
        configPath,
        all: true,
        yes: true,
      });
    }
    console.log(styleText("green", "Truncate completed.\n"));
  } catch (error) {
    console.error(styleText("red", `Truncate failed: ${error.message}`));
    process.exit(1);
  }
}

// Get application info and endpoint
const appInfo = await show({ configPath });
const endpoint = `${appInfo.url}/query`;

// Get machine user token
const tokenInfo = await getMachineUserToken({ name: "manager-machine-user", configPath });

// Initialize GQLIngest client
const client = new GQLIngest({
  endpoint,
  headers: {
    Authorization: `Bearer ${tokenInfo.accessToken}`,
  },
});

// Progress monitoring event handlers
client.on("started", (payload) => {
  console.log(styleText("cyan", `Processing ${payload.totalEntities} entities...`));
});

client.on("entityStart", (payload) => {
  console.log(styleText("dim", `  Processing ${payload.entityName}...`));
});

client.on("entityComplete", (payload) => {
  const { entityName, successCount } = payload;
  console.log(styleText("green", `  ✓ ${entityName}: ${successCount} rows processed`));
});

client.on("rowFailure", (payload) => {
  console.error(styleText("red", `  ✗ Row ${payload.rowIndex} in ${payload.entityName} failed: ${payload.error.message}`));
});

// Run ingestion
try {
  let result;
  if (entitiesToProcess && entitiesToProcess.length > 0) {
    result = await client.ingestEntities(configDir, entitiesToProcess);
  } else {
    result = await client.ingest(configDir);
  }

  if (result.success) {
    console.log(styleText("green", "\n✓ Seed data generation completed successfully"));
    console.log(client.getMetricsSummary());
  } else {
    console.error(styleText("red", "\n✗ Seed data generation failed"));
    console.error(client.getMetricsSummary());
    process.exit(1);
  }
} catch (error) {
  console.error(styleText("red", `\n✗ Seed data generation failed with error: ${error.message}`));
  process.exit(1);
}