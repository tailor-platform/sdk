import { afterAll, beforeAll, describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  expectEnumValues,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";
import { setupTailordbMock, cleanupMocks } from "../../../shared/mocks.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("005-fullstack-feature-wiring", () => {
  // ---------------------------------------------------------------------------
  // Registration model
  // ---------------------------------------------------------------------------
  describe("Registration model", () => {
    test("model name is Registration", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expect(mod.registration.name).toBe("Registration");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expectFieldNames(mod.registration, [
        "email",
        "name",
        "plan",
        "role",
        "userId",
        "status",
        "referralCode",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("email is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expectFieldType(mod.registration.fields.email, "string", { required: true });
    });

    test("plan is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expectEnumValues(mod.registration.fields.plan, ["free", "basic", "premium", "enterprise"]);
    });

    test("status is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expectEnumValues(mod.registration.fields.status, ["pending", "active", "suspended"]);
    });

    test("userId is uuid optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expectFieldType(mod.registration.fields.userId, "uuid", { required: false });
    });

    test("has indexes with length >= 2", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      const indexes = mod.registration.metadata.indexes;
      expect(indexes).toBeDefined();
      expect(Object.keys(indexes).length).toBeGreaterThanOrEqual(2);
    });

    test("first index contains email and is unique", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      const indexes = mod.registration.metadata.indexes;
      const firstIdx = Object.values(indexes)[0] as { fields: string[]; unique?: boolean };
      expect(firstIdx.fields).toContain("email");
      expect(firstIdx.unique).toBe(true);
    });

    test("has aggregation feature", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expect(mod.registration.metadata.settings?.aggregation).toBe(true);
    });

    test("has permission with create/read/update/delete", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      const permission = mod.registration.metadata.permissions?.record;
      expect(permission).toBeDefined();
      expect(permission.create).toBeDefined();
      expect(permission.read).toBeDefined();
      expect(permission.update).toBeDefined();
      expect(permission.delete).toBeDefined();
    });

    test("has gqlPermission as array", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      const gqlPerm = mod.registration.metadata.permissions?.gql;
      expect(gqlPerm).toBeDefined();
      expect(Array.isArray(gqlPerm)).toBe(true);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/registration.ts"));
      expectTimestamps(mod.registration);
    });
  });

  // ---------------------------------------------------------------------------
  // registerUser resolver
  // ---------------------------------------------------------------------------
  describe("registerUser resolver", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let resolver: Record<string, any>;

    beforeAll(async () => {
      setupTailordbMock((_query, params) => {
        if (params.some((p) => String(p).includes("existing@test.com"))) {
          return [{ id: "existing-id" }];
        }
        return [];
      });

      const mod = await importPath(path.join(workDir, "resolvers/registerUser.ts"));
      resolver = mod.default;
    });

    afterAll(() => {
      cleanupMocks();
    });

    test("name is registerUser", () => {
      expect(resolver.name).toBe("registerUser");
    });

    test("operation is mutation", () => {
      expect(resolver.operation).toBe("mutation");
    });

    test("has input fields: email, name, plan, referralCode", () => {
      expect(resolver.input).toHaveProperty("email");
      expect(resolver.input).toHaveProperty("name");
      expect(resolver.input).toHaveProperty("plan");
      expect(resolver.input).toHaveProperty("referralCode");
    });

    test("plan input is enum", () => {
      expect(resolver.input.plan.type).toBe("enum");
    });

    test("referralCode input is optional", () => {
      expect(resolver.input.referralCode.metadata.required).toBe(false);
    });

    test("output has success, message, workflowRunId", () => {
      const fields = resolver.output.fields;
      expect(fields).toHaveProperty("success");
      expect(fields).toHaveProperty("message");
      expect(fields).toHaveProperty("workflowRunId");
    });

    test("returns error for existing email", async () => {
      const result = await resolver.body({
        input: { email: "existing@test.com", name: "Test", plan: "basic" },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain("already registered");
    });

    test("succeeds for new email", async () => {
      const result = await resolver.body({
        input: { email: "new@test.com", name: "New User", plan: "premium" },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(true);
      expect(result.workflowRunId).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // registrationCreated executor
  // ---------------------------------------------------------------------------
  describe("registrationCreated executor", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/registrationCreated.ts"));
      executor = mod.default;
    });

    test("name is registration-created", () => {
      expect(executor.name).toBe("registration-created");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is recordCreated on Registration", () => {
      expect(executor.trigger.kind).toBe("recordCreated");
      expect(executor.trigger.typeName).toBe("Registration");
    });

    test("condition: paid plan (basic) triggers", () => {
      const { condition } = executor.trigger;
      expect(condition({ newRecord: { plan: "basic" } })).toBe(true);
    });

    test("condition: free plan does not trigger", () => {
      const { condition } = executor.trigger;
      expect(condition({ newRecord: { plan: "free" } })).toBe(false);
    });

    test("operation kind is webhook", () => {
      expect(executor.operation.kind).toBe("webhook");
    });

    test("webhook headers has vault secret", () => {
      const { headers } = executor.operation;
      expect(headers.Authorization).toEqual({
        vault: "billing-service",
        key: "api-key",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Workflow jobs (onboardingJobs.ts)
  // ---------------------------------------------------------------------------
  describe("workflow jobs", () => {
    test("setupAccount job name is setup-account", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      expect(mod.setupAccount.name).toBe("setup-account");
    });

    test("assignDefaults job name is assign-defaults", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      expect(mod.assignDefaults.name).toBe("assign-defaults");
    });

    test("onboardUser job name is onboard-user", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      expect(mod.onboardUser.name).toBe("onboard-user");
    });

    test("assignDefaults gives correct quota for free plan", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = mod.assignDefaults.body({ accountId: "acc-1", plan: "free" });
      expect(result.storageQuota).toBe(100);
    });

    test("assignDefaults gives correct quota for basic plan", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = mod.assignDefaults.body({ accountId: "acc-1", plan: "basic" });
      expect(result.storageQuota).toBe(1000);
    });

    test("assignDefaults gives correct quota for premium plan", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = mod.assignDefaults.body({ accountId: "acc-1", plan: "premium" });
      expect(result.storageQuota).toBe(10000);
    });

    test("assignDefaults gives correct quota for enterprise plan", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = mod.assignDefaults.body({ accountId: "acc-1", plan: "enterprise" });
      expect(result.storageQuota).toBe(100000);
      expect(result.apiRateLimit).toBe(10000);
    });

    test("assignDefaults gives default apiRateLimit for non-enterprise", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = mod.assignDefaults.body({ accountId: "acc-1", plan: "basic" });
      expect(result.apiRateLimit).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // Workflow (onboarding.ts)
  // ---------------------------------------------------------------------------
  describe("onboarding workflow", () => {
    test("workflow name is user-onboarding", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboarding.ts"));
      expect(mod.default.name).toBe("user-onboarding");
    });

    test("has default export (workflow)", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboarding.ts"));
      expect(mod.default).toBeDefined();
      expect(mod.default.name).toBeDefined();
      expect(mod.default.mainJob).toBeDefined();
    });

    test("all jobs re-exported from onboarding.ts", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboarding.ts"));
      expect(mod.onboardUser).toBeDefined();
      expect(mod.setupAccount).toBeDefined();
      expect(mod.assignDefaults).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Orchestration end-to-end
  // ---------------------------------------------------------------------------
  describe("onboardUser orchestration", () => {
    test("onboardUser returns correct orchestrated result", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = await mod.onboardUser.body({
        email: "user@example.com",
        name: "Test User",
        plan: "premium",
        referralCode: "REF123",
      });
      expect(result.accountId).toBeDefined();
      expect(result.email).toBe("user@example.com");
      expect(result.plan).toBe("premium");
      expect(result.storageQuota).toBe(10000);
      expect(result.apiRateLimit).toBe(1000);
      expect(result.referralCode).toBe("REF123");
    });

    test("onboardUser calls setupAccount and assignDefaults", async () => {
      const mod = await importPath(path.join(workDir, "workflows/onboardingJobs.ts"));
      const result = await mod.onboardUser.body({
        email: "test@example.com",
        name: "Test",
        plan: "basic",
        referralCode: "",
      });
      // setupAccount produces accountId from email
      expect(result.accountId).toBe("acc-test");
      // assignDefaults produces quota values based on plan
      expect(result.storageQuota).toBe(1000);
      expect(result.apiRateLimit).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // Config (tailor.config.ts)
  // ---------------------------------------------------------------------------
  describe("tailor.config.ts", () => {
    test("config name is challenge-005", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.name).toBe("challenge-005");
    });

    test("has cors array (non-empty)", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.cors).toBeDefined();
      expect(mod.default.cors.length).toBeGreaterThan(0);
    });

    test("has db.tailordb configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.db).toBeDefined();
      expect(mod.default.db.tailordb).toBeDefined();
    });

    test("has resolver configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.resolver).toBeDefined();
    });

    test("has executor configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.executor).toBeDefined();
    });

    test("has auth configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth).toBeDefined();
    });

    test("has staticWebsites configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.staticWebsites).toBeDefined();
      expect(mod.default.staticWebsites.length).toBeGreaterThan(0);
    });

    test("generators are exported", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.generators).toBeDefined();
      expect(Array.isArray(mod.generators)).toBe(true);
    });
  });
});
