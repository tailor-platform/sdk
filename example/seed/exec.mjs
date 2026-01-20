import { GQLIngest } from "@jackchuka/gql-ingest";
import { join } from "node:path";
import { show, getMachineUserToken } from "@tailor-platform/sdk/cli";

const configDir = import.meta.dirname;
const configPath = join(configDir, "../tailor.config.ts");

console.log("Starting seed data generation...");

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
  const result = await client.ingest(configDir);

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