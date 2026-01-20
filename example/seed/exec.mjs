import { GQLIngest } from "@jackchuka/gql-ingest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { show, getMachineUserToken } from "@tailor-platform/sdk/cli";

// Parse command-line arguments
const { values, positionals } = parseArgs({
  options: {
    namespace: { type: "string", short: "n" },
    "skip-idp": { type: "boolean", default: false },
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
  -h, --help           Show help

Examples:
  node exec.mjs                       # Process all types (default)
  node exec.mjs --namespace tailordb  # Process tailordb namespace only (no _User)
  node exec.mjs User Order            # Process specific types only
  node exec.mjs --skip-idp            # Process all except _User
  `);
  process.exit(0);
}

const configDir = import.meta.dirname;
const configPath = join(configDir, "../tailor.config.ts");

console.log("Starting seed data generation...");

// Load config.yaml to get entity-namespace mapping
const configYamlPath = join(configDir, "config.yaml");
const configYaml = parse(readFileSync(configYamlPath, "utf-8"));
const entityNamespaces = configYaml.entityNamespaces || {};
const entityDependencies = configYaml.entityDependencies || {};

// Determine which entities to process
let entitiesToProcess = null;

const hasNamespace = !!values.namespace;
const hasTypes = positionals.length > 0;
const skipIdp = values["skip-idp"];

// Validate mutually exclusive options
const optionCount = [hasNamespace, hasTypes].filter(Boolean).length;
if (optionCount > 1) {
  console.error("Error: Options --namespace and type names are mutually exclusive.");
  process.exit(1);
}

// --skip-idp and --namespace are redundant (namespace already excludes _User)
if (skipIdp && hasNamespace) {
  console.error("Error: --skip-idp is redundant with --namespace (namespace filtering already excludes _User).");
  process.exit(1);
}

// Filter by namespace (automatically excludes _User as it has no namespace)
if (hasNamespace) {
  const namespace = values.namespace;
  entitiesToProcess = Object.keys(entityNamespaces).filter(
    (entity) => entityNamespaces[entity] === namespace
  );

  if (entitiesToProcess.length === 0) {
    console.error(`Error: No entities found in namespace "${namespace}"`);
    console.error(`Available namespaces: ${[...new Set(Object.values(entityNamespaces))].join(", ")}`);
    process.exit(1);
  }

  console.log(`Filtering by namespace: ${namespace}`);
  console.log(`Entities: ${entitiesToProcess.join(", ")}`);
  console.log(`Note: _User (IdP user) is automatically excluded when filtering by namespace`);
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
    console.error(`Error: The following types were not found: ${notFoundTypes.join(", ")}`);
    console.error(`Available types: ${Object.keys(entityDependencies).join(", ")}`);
    process.exit(1);
  }

  console.log(`Filtering by types: ${entitiesToProcess.join(", ")}`);
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
  console.log(`Skipping IdP user (_User)`);
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
  console.log(`Processing ${payload.totalEntities} entities...`);
});

client.on("entityStart", (payload) => {
  console.log(`  Processing ${payload.entityName}...`);
});

client.on("entityComplete", (payload) => {
  const { entityName, successCount } = payload;
  console.log(`  ✓ ${entityName}: ${successCount} rows processed`);
});

client.on("rowFailure", (payload) => {
  console.error(`  ✗ Row ${payload.rowIndex} in ${payload.entityName} failed: ${payload.error.message}`);
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
    console.log("\n✓ Seed data generation completed successfully");
    console.log(client.getMetricsSummary());
  } else {
    console.error("\n✗ Seed data generation failed");
    console.error(client.getMetricsSummary());
    process.exit(1);
  }
} catch (error) {
  console.error("\n✗ Seed data generation failed with error:", error.message);
  process.exit(1);
}