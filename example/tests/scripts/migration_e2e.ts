import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bundleMigrationScript,
  bundleSeedScript,
  executeScript,
  getMachineUserToken,
  initOperatorClient,
  loadAccessToken,
  loadWorkspaceId,
  show,
} from "@tailor-platform/sdk/cli";
import { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { create } from "@bufbuild/protobuf";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(scriptDir, "..", "..");
const configPath = path.resolve(exampleDir, "tailor.config.ts");

const namespace = "tailordb";
const machineUserName = "manager-machine-user";

const runPnpm = (args: string[], extraEnv: Record<string, string> = {}) => {
  execFileSync("pnpm", args, {
    cwd: exampleDir,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: "inherit",
  });
};

const applyWithVersion = (version?: string) => {
  const env: Record<string, string> = {};
  if (version) {
    env.TAILOR_INTERNAL_APPLY_MIGRATION_VERSION = version;
  }
  runPnpm(["run", "apply"], env);
};

const generate = () => {
  runPnpm(["run", "generate"]);
};

const accessToken = await loadAccessToken();
const workspaceId = await loadWorkspaceId();
const client = await initOperatorClient(accessToken);
const appInfo = await show({ configPath });
const authNamespace = appInfo.auth;

await getMachineUserToken({ name: machineUserName, configPath });

const invoker = create(AuthInvokerSchema, {
  namespace: authNamespace,
  machineUserName,
});

let scriptCounter = 9000;

const runAssertionScript = async (relativePath: string, label: string) => {
  const scriptPath = path.resolve(exampleDir, "tests/scripts/migration", relativePath);
  const bundled = await bundleMigrationScript(scriptPath, namespace, scriptCounter++);
  const result = await executeScript({
    client,
    workspaceId,
    name: label,
    code: bundled.bundledCode,
    invoker,
  });
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? "unknown error"}`);
  }
};

const seedData = async (
  data: Record<string, Record<string, unknown>[]>,
  order: string[],
  label: string,
) => {
  const bundled = await bundleSeedScript(namespace, order);
  const result = await executeScript({
    client,
    workspaceId,
    name: label,
    code: bundled.bundledCode,
    arg: JSON.stringify({ data, order }),
    invoker,
  });
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? "unknown error"}`);
  }
};

const fetchTypes = async () => {
  const { tailordbTypes } = await client.listTailorDBTypes({
    workspaceId,
    namespaceName: namespace,
  });
  return tailordbTypes ?? [];
};

const getType = (types: { name?: string }[], name: string) => {
  const type = types.find((t) => t.name === name);
  if (!type) {
    throw new Error(`Type not found: ${name}`);
  }
  return type as { schema?: Record<string, unknown> } & { name: string };
};

const getField = (
  type: { schema?: Record<string, unknown> } & { name: string },
  fieldName: string,
) => {
  const schema = type.schema as { fields?: Record<string, Record<string, unknown>> } | undefined;
  const field = schema?.fields?.[fieldName];
  if (!field) {
    throw new Error(`Field not found: ${type.name}.${fieldName}`);
  }
  return field;
};

const normalizeEnumValues = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && "value" in value) {
        return String((value as { value: unknown }).value);
      }
      return "";
    })
    .filter(Boolean);
};

const assertSchemaAfter0004 = (types: { name?: string }[]) => {
  const user = getType(types, "User");
  getField(user, "status");
  getField(user, "department");
  const roleField = getField(user, "role");
  const allowedValues = normalizeEnumValues(roleField.allowedValues);
  if (!allowedValues.includes("UNKNOWN")) {
    throw new Error("User.role enum should include UNKNOWN after 0004");
  }
};

const assertSchemaAfter0005 = (types: { name?: string }[]) => {
  const user = getType(types, "User");
  const roleField = getField(user, "role");
  const allowedValues = normalizeEnumValues(roleField.allowedValues);
  if (allowedValues.includes("UNKNOWN")) {
    throw new Error("User.role enum should not include UNKNOWN after 0005");
  }

  const supplier = getType(types, "Supplier");
  const nameField = getField(supplier, "name");
  const countryField = getField(supplier, "country");
  if (nameField.required !== true || countryField.required !== true) {
    throw new Error("Supplier.name and Supplier.country should be required after 0005");
  }
};

const assertSchemaAfterFinal = (types: { name?: string }[]) => {
  const user = getType(types, "User");
  const userSchema = user.schema as {
    fields?: Record<string, Record<string, unknown>>;
    indexes?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  const nameField = getField(user, "name");
  if (nameField.unique === true) {
    throw new Error("User.name should not be unique after 0007");
  }
  if (!userSchema?.indexes?.idx_name_department || !userSchema?.indexes?.user_status_created_idx) {
    throw new Error("User indexes should include idx_name_department and user_status_created_idx");
  }
  if (!userSchema?.files?.avatar) {
    throw new Error("User files should include avatar after 0007");
  }

  const salesOrder = getType(types, "SalesOrder");
  const salesSchema = salesOrder.schema as {
    indexes?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  if (!salesSchema?.indexes?.idx_status_createdAt || !salesSchema?.indexes?.idx_customerID_status) {
    throw new Error(
      "SalesOrder indexes should include idx_status_createdAt and idx_customerID_status",
    );
  }
  if (!salesSchema?.files?.receipt || !salesSchema?.files?.form) {
    throw new Error("SalesOrder files should include receipt and form");
  }
};

const baseUsers = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Duplicate",
    email: "duplicate-1@example.com",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Duplicate",
    email: "duplicate-2@example.com",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Unique",
    email: "unique@example.com",
  },
];

const baseSuppliers = [
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: null,
    country: null,
    phone: "000-0000",
    postalCode: "000-0000",
    state: "Alabama",
    city: "Test City",
  },
];

const unknownRoleUser = [
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Unknown Role",
    email: "unknown-role@example.com",
    role: "UNKNOWN",
  },
];

console.log("Generating artifacts...");
generate();

console.log("Applying base schema (0000)...");
applyWithVersion("0000");

console.log("Seeding base data...");
await seedData(
  {
    User: baseUsers,
    Supplier: baseSuppliers,
  },
  ["User", "Supplier"],
  "seed-base",
);

console.log("Applying migrations through 0004...");
applyWithVersion("0004");

await runAssertionScript("assert_roles_populated.ts", "assert-roles-populated");
assertSchemaAfter0004(await fetchTypes());

console.log("Seeding UNKNOWN role user...");
await seedData({ User: unknownRoleUser }, ["User"], "seed-unknown-role");

console.log("Applying migration 0005...");
applyWithVersion("0005");

await runAssertionScript("assert_after_0005.ts", "assert-after-0005");
assertSchemaAfter0005(await fetchTypes());

console.log("Applying migration 0006...");
applyWithVersion("0006");

await runAssertionScript("assert_no_duplicate_names.ts", "assert-no-duplicates");

console.log("Applying latest migrations...");
applyWithVersion();

assertSchemaAfterFinal(await fetchTypes());

console.log("Migration e2e completed successfully.");
