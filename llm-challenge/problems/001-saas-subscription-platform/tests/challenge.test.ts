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
import { setupTailordbMock, setupWorkflowMock, cleanupMocks } from "../../../shared/mocks.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

// Extract the validate function from metadata.validate which may be stored as:
// - a bare function
// - an array of functions [fn]
// - an array of tuples [[fn, "message"]]
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function extractValidateFn(validate: any): (input: any) => boolean {
  if (typeof validate === "function") return validate;
  const first = validate[0];
  if (typeof first === "function") return first;
  if (Array.isArray(first) && typeof first[0] === "function") return first[0];
  throw new Error("Could not extract validate function");
}

describe.skipIf(!workDirReady)("001-saas-subscription-platform", () => {
  // ===========================================================================
  // MODELS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Organization
  // ---------------------------------------------------------------------------
  describe("Organization model", () => {
    test("model name is Organization", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expect(mod.organization.name).toBe("Organization");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expectFieldNames(mod.organization, [
        "name",
        "domain",
        "plan",
        "billingAddress",
        "orgCode",
        "contactEmail",
        "maxSeats",
        "active",
        "tags",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("name is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expectFieldType(mod.organization.fields.name, "string", { required: true });
    });

    test("domain is string required and unique", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expectFieldType(mod.organization.fields.domain, "string", {
        required: true,
        unique: true,
      });
    });

    test("plan is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expectEnumValues(mod.organization.fields.plan, ["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]);
    });

    test("billingAddress is nested object with 5 sub-fields", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const addr = mod.organization.fields.billingAddress;
      expect(addr.type).toBe("nested");
      const subFieldNames = Object.keys(addr.fields);
      expect(subFieldNames).toContain("street");
      expect(subFieldNames).toContain("city");
      expect(subFieldNames).toContain("state");
      expect(subFieldNames).toContain("postalCode");
      expect(subFieldNames).toContain("country");
    });

    test("billingAddress sub-fields are all string type", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const addr = mod.organization.fields.billingAddress;
      for (const name of ["street", "city", "state", "postalCode", "country"]) {
        expect(addr.fields[name].type).toBe("string");
      }
    });

    test("orgCode is string with serial config ORG-%04d", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const field = mod.organization.fields.orgCode;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.format).toBe("ORG-%04d");
    });

    test("contactEmail create hook lowercases value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const field = mod.organization.fields.contactEmail;
      expect(field.metadata.required).toBe(true);
      const hook = field.metadata.hooks?.create;
      expect(hook).toBeDefined();
      const result = hook({ value: "HELLO@Example.COM", data: {}, user: {} });
      expect(result).toBe("hello@example.com");
    });

    test("contactEmail create hook returns falsy for null/undefined", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const hook = mod.organization.fields.contactEmail.metadata.hooks?.create;
      expect(hook).toBeDefined();
      const result = hook({ value: null, data: {}, user: {} });
      expect(!result).toBe(true);
    });

    test("maxSeats create hook defaults to 5", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const hook = mod.organization.fields.maxSeats.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBe(5);
    });

    test("maxSeats create hook preserves provided value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const hook = mod.organization.fields.maxSeats.metadata.hooks?.create;
      expect(hook({ value: 20, data: {}, user: {} })).toBe(20);
    });

    test("active is bool required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expectFieldType(mod.organization.fields.active, "boolean", { required: true });
    });

    test("tags is string array optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const field = mod.organization.fields.tags;
      expect(field.type).toBe("string");
      expect(field.metadata.array).toBe(true);
      expect(field.metadata.required).toBe(false);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expectTimestamps(mod.organization);
    });

    test("has non-empty description", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      expect(mod.organization.metadata.description).toBeDefined();
      expect(mod.organization.metadata.description.length).toBeGreaterThan(0);
    });

    test("domain field has unique constraint", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const domain = mod.organization.fields.domain;
      expect(domain.metadata.unique).toBe(true);
    });

    test("has permission with create/read/update/delete", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const permission = mod.organization.metadata.permissions?.record;
      expect(permission).toBeDefined();
      expect(permission.create).toBeDefined();
      expect(permission.read).toBeDefined();
      expect(permission.update).toBeDefined();
      expect(permission.delete).toBeDefined();
    });

    test("has gqlPermission as array", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
      const gqlPerm = mod.organization.metadata.permissions?.gql;
      expect(gqlPerm).toBeDefined();
      expect(Array.isArray(gqlPerm)).toBe(true);
      expect(gqlPerm.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------
  describe("Subscription model", () => {
    test("model name is Subscription", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expect(mod.subscription.name).toBe("Subscription");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectFieldNames(mod.subscription, [
        "organizationId",
        "plan",
        "status",
        "startDate",
        "endDate",
        "monthlyRate",
        "autoRenew",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("organizationId has n-1 relation to Organization", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const field = mod.subscription.fields.organizationId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Organization");
    });

    test("plan is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectEnumValues(mod.subscription.fields.plan, ["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]);
    });

    test("status is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectEnumValues(mod.subscription.fields.status, ["TRIAL", "ACTIVE", "PAUSED", "CANCELLED"]);
    });

    test("startDate is date required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectFieldType(mod.subscription.fields.startDate, "date", { required: true });
    });

    test("endDate is date optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectFieldType(mod.subscription.fields.endDate, "date", { required: false });
    });

    test("monthlyRate is float with validation", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const field = mod.subscription.fields.monthlyRate;
      expect(field.type).toBe("float");
      expect(field.metadata.validate).toBeDefined();
    });

    test("monthlyRate validation accepts 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const validate = mod.subscription.fields.monthlyRate.metadata.validate;
      const fn = extractValidateFn(validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
    });

    test("monthlyRate validation rejects -1", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const validate = mod.subscription.fields.monthlyRate.metadata.validate;
      const fn = extractValidateFn(validate);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
    });

    test("autoRenew is bool required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectFieldType(mod.subscription.fields.autoRenew, "boolean", { required: true });
    });

    test("has composite index on organizationId and status", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const indexes = mod.subscription.metadata.indexes;
      expect(indexes).toBeDefined();
      const indexEntries = Object.values(indexes) as { fields: string[] }[];
      const compositeIdx = indexEntries.find(
        (idx) => idx.fields.includes("organizationId") && idx.fields.includes("status"),
      );
      expect(compositeIdx, "expected composite index on organizationId and status").toBeDefined();
    });

    test("has aggregation feature", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expect(mod.subscription.metadata.settings?.aggregation).toBe(true);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      expectTimestamps(mod.subscription);
    });

    test("endDate has update hook defined", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const hooks = mod.subscription.fields.endDate.metadata.hooks;
      expect(hooks).toBeDefined();
      expect(typeof hooks.update).toBe("function");
    });

    test("endDate update hook: CANCELLED status sets endDate to date string", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const updateFn = mod.subscription.fields.endDate.metadata.hooks.update;
      const result = updateFn({ value: null, data: { status: "CANCELLED" }, user: {} });
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    test("endDate update hook: ACTIVE status preserves original value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const updateFn = mod.subscription.fields.endDate.metadata.hooks.update;
      const result = updateFn({ value: "2026-06-01", data: { status: "ACTIVE" }, user: {} });
      expect(result).toBe("2026-06-01");
    });

    test("endDate update hook: non-CANCELLED status does not change value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/subscription.ts"));
      const updateFn = mod.subscription.fields.endDate.metadata.hooks.update;
      const paused = updateFn({ value: "2026-05-01", data: { status: "PAUSED" }, user: {} });
      expect(paused).toBe("2026-05-01");
      const trial = updateFn({ value: "2026-03-01", data: { status: "TRIAL" }, user: {} });
      expect(trial).toBe("2026-03-01");
    });
  });

  // ---------------------------------------------------------------------------
  // Invoice
  // ---------------------------------------------------------------------------
  describe("Invoice model", () => {
    test("model name is Invoice", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expect(mod.invoice.name).toBe("Invoice");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expectFieldNames(mod.invoice, [
        "subscriptionId",
        "invoiceNumber",
        "amount",
        "currency",
        "issuedAt",
        "dueDate",
        "paid",
        "notes",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("subscriptionId has n-1 relation to Subscription", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      const field = mod.invoice.fields.subscriptionId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Subscription");
    });

    test("invoiceNumber has serial config INV-%06d", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      const field = mod.invoice.fields.invoiceNumber;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.format).toBe("INV-%06d");
    });

    test("amount is float required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expectFieldType(mod.invoice.fields.amount, "float", { required: true });
    });

    test("currency is enum USD/EUR/JPY", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expectEnumValues(mod.invoice.fields.currency, ["USD", "EUR", "JPY"]);
    });

    test("issuedAt is datetime with create hook", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      const field = mod.invoice.fields.issuedAt;
      expect(field.type).toBe("datetime");
      expect(field.metadata.hooks?.create).toBeDefined();
      const result = field.metadata.hooks.create({ value: undefined, data: {}, user: {} });
      expect(result).toBeInstanceOf(Date);
    });

    test("dueDate is date required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expectFieldType(mod.invoice.fields.dueDate, "date", { required: true });
    });

    test("paid is bool optional with create hook defaulting false", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      const field = mod.invoice.fields.paid;
      expect(field.type).toBe("boolean");
      expect(field.metadata.required).toBe(false);
      const hook = field.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBe(false);
      expect(hook({ value: true, data: {}, user: {} })).toBe(true);
    });

    test("notes is string optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expectFieldType(mod.invoice.fields.notes, "string", { required: false });
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/invoice.ts"));
      expectTimestamps(mod.invoice);
    });
  });

  // ---------------------------------------------------------------------------
  // UsageRecord
  // ---------------------------------------------------------------------------
  describe("UsageRecord model", () => {
    test("model name is UsageRecord", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      expect(mod.usageRecord.name).toBe("UsageRecord");
    });

    test("subscriptionId has n-1 relation to Subscription", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      const field = mod.usageRecord.fields.subscriptionId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Subscription");
    });

    test("metric is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      expectFieldType(mod.usageRecord.fields.metric, "string", { required: true });
    });

    test("quantity is float with validation > 0", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      const field = mod.usageRecord.fields.quantity;
      expect(field.type).toBe("float");
      expect(field.metadata.validate).toBeDefined();
      const fn = extractValidateFn(field.metadata.validate);
      // Strictly greater than 0 - must reject 0
      expect(fn({ value: 0, data: {}, user: {} })).toBe(false);
      expect(fn({ value: 0.001, data: {}, user: {} })).toBe(true);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
    });

    test("recordedAt is datetime with create hook", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      const field = mod.usageRecord.fields.recordedAt;
      expect(field.type).toBe("datetime");
      expect(field.metadata.hooks?.create).toBeDefined();
    });

    test("description is string optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      expectFieldType(mod.usageRecord.fields.description, "string", { required: false });
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/usageRecord.ts"));
      expectTimestamps(mod.usageRecord);
    });
  });

  // ---------------------------------------------------------------------------
  // AuditEvent
  // ---------------------------------------------------------------------------
  describe("AuditEvent model", () => {
    test("model name is AuditEvent", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      expect(mod.auditEvent.name).toBe("AuditEvent");
    });

    test("organizationId has n-1 relation to Organization", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      const field = mod.auditEvent.fields.organizationId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.toward.type).toBe("Organization");
    });

    test("action is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      expectEnumValues(mod.auditEvent.fields.action, [
        "CREATE",
        "UPDATE",
        "DELETE",
        "LOGIN",
        "EXPORT",
      ]);
    });

    test("actor is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      expectFieldType(mod.auditEvent.fields.actor, "string", { required: true });
    });

    test("target is string optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      expectFieldType(mod.auditEvent.fields.target, "string", { required: false });
    });

    test("metadata is nested object with ip, userAgent, requestId", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      const meta = mod.auditEvent.fields.metadata;
      expect(meta.type).toBe("nested");
      expect(meta.fields.ip).toBeDefined();
      expect(meta.fields.ip.type).toBe("string");
      expect(meta.fields.userAgent).toBeDefined();
      expect(meta.fields.userAgent.type).toBe("string");
      expect(meta.fields.userAgent.metadata.required).toBe(false);
      expect(meta.fields.requestId).toBeDefined();
      expect(meta.fields.requestId.type).toBe("uuid");
    });

    test("occurredAt is datetime with create hook", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      const field = mod.auditEvent.fields.occurredAt;
      expect(field.type).toBe("datetime");
      expect(field.metadata.hooks?.create).toBeDefined();
    });

    test("tags is string array optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      const field = mod.auditEvent.fields.tags;
      expect(field.type).toBe("string");
      expect(field.metadata.array).toBe(true);
      expect(field.metadata.required).toBe(false);
    });

    test("has createdAt field", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      expect(mod.auditEvent.fields.createdAt).toBeDefined();
      expect(mod.auditEvent.fields.createdAt.type).toBe("datetime");
      expect(mod.auditEvent.fields.createdAt.metadata.hooks?.create).toBeDefined();
    });

    test("does NOT have updatedAt field", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/auditEvent.ts"));
      expect(mod.auditEvent.fields.updatedAt).toBeUndefined();
    });
  });

  // ===========================================================================
  // RESOLVERS
  // ===========================================================================
  describe("upgradeSubscription resolver", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let resolver: Record<string, any>;

    beforeAll(async () => {
      setupTailordbMock((_query, params) => {
        // Kysely passes params as an array; match on any param value
        const paramStr = params.map(String).join(",");
        if (paramStr.includes("sub-active")) {
          return [{ id: "sub-active", plan: "STARTER", status: "ACTIVE" }];
        }
        if (paramStr.includes("sub-paused")) {
          return [{ id: "sub-paused", plan: "BUSINESS", status: "PAUSED" }];
        }
        if (paramStr.includes("sub-enterprise")) {
          return [{ id: "sub-enterprise", plan: "ENTERPRISE", status: "ACTIVE" }];
        }
        return [];
      });

      const mod = await importPath(path.join(workDir, "resolvers/upgradeSubscription.ts"));
      resolver = mod.default;
    });

    afterAll(() => {
      cleanupMocks();
    });

    test("name is upgradeSubscription", () => {
      expect(resolver.name).toBe("upgradeSubscription");
    });

    test("operation is mutation", () => {
      expect(resolver.operation).toBe("mutation");
    });

    test("input has subscriptionId, targetPlan, effectiveDate", () => {
      expect(resolver.input).toHaveProperty("subscriptionId");
      expect(resolver.input).toHaveProperty("targetPlan");
      expect(resolver.input).toHaveProperty("effectiveDate");
    });

    test("output has success, error, previousPlan, newPlan, proratedAmount, effectiveDate", () => {
      const fields = resolver.output.fields;
      expect(fields).toHaveProperty("success");
      expect(fields).toHaveProperty("error");
      expect(fields).toHaveProperty("previousPlan");
      expect(fields).toHaveProperty("newPlan");
      expect(fields).toHaveProperty("proratedAmount");
      expect(fields).toHaveProperty("effectiveDate");
    });

    test("non-existent subscription returns error", async () => {
      const result = await resolver.body({
        input: {
          subscriptionId: "non-existent",
          targetPlan: "BUSINESS",
          effectiveDate: "2026-04-01",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("non-ACTIVE subscription returns error", async () => {
      const result = await resolver.body({
        input: {
          subscriptionId: "sub-paused",
          targetPlan: "ENTERPRISE",
          effectiveDate: "2026-04-01",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not active");
    });

    test("upgrade STARTER->BUSINESS succeeds", async () => {
      const result = await resolver.body({
        input: {
          subscriptionId: "sub-active",
          targetPlan: "BUSINESS",
          effectiveDate: "2026-04-01",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(true);
      expect(result.previousPlan).toBe("STARTER");
      expect(result.newPlan).toBe("BUSINESS");
      expect(result.proratedAmount).toBe(99.99);
    });

    test("upgrade STARTER->ENTERPRISE returns 299.99", async () => {
      const result = await resolver.body({
        input: {
          subscriptionId: "sub-active",
          targetPlan: "ENTERPRISE",
          effectiveDate: "2026-04-01",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(true);
      expect(result.proratedAmount).toBe(299.99);
    });

    test("downgrade STARTER->FREE fails", async () => {
      const result = await resolver.body({
        input: { subscriptionId: "sub-active", targetPlan: "FREE", effectiveDate: "2026-04-01" },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("higher plan");
    });

    test("same plan STARTER->STARTER fails", async () => {
      const result = await resolver.body({
        input: { subscriptionId: "sub-active", targetPlan: "STARTER", effectiveDate: "2026-04-01" },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("higher plan");
    });

    test("same plan ENTERPRISE->ENTERPRISE fails", async () => {
      const result = await resolver.body({
        input: {
          subscriptionId: "sub-enterprise",
          targetPlan: "ENTERPRISE",
          effectiveDate: "2026-04-01",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("effectiveDate passes through", async () => {
      const result = await resolver.body({
        input: {
          subscriptionId: "sub-active",
          targetPlan: "ENTERPRISE",
          effectiveDate: "2026-07-15",
        },
        user: { id: "u1", type: "user", attributes: {} },
        env: {},
      });
      expect(result.effectiveDate).toBe("2026-07-15");
    });
  });

  // ===========================================================================
  // EXECUTORS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // invoiceCreated
  // ---------------------------------------------------------------------------
  describe("invoiceCreated executor", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/invoiceCreated.ts"));
      executor = mod.default;
    });

    test("name is invoice-created", () => {
      expect(executor.name).toBe("invoice-created");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is recordCreated on Invoice", () => {
      expect(executor.trigger.kind).toBe("tailordb");
      expect(executor.trigger.events).toEqual(["tailordb.type_record.created"]);
      expect(executor.trigger.typeName).toBe("Invoice");
    });

    test("condition: amount > 0 fires", () => {
      const { condition } = executor.trigger;
      expect(condition({ newRecord: { amount: 100 } })).toBe(true);
      expect(condition({ newRecord: { amount: 0.01 } })).toBe(true);
    });

    test("condition: amount = 0 does not fire", () => {
      const { condition } = executor.trigger;
      expect(condition({ newRecord: { amount: 0 } })).toBe(false);
    });

    test("condition: amount < 0 does not fire", () => {
      const { condition } = executor.trigger;
      expect(condition({ newRecord: { amount: -10 } })).toBe(false);
    });

    test("operation kind is webhook", () => {
      expect(executor.operation.kind).toBe("webhook");
    });

    test("webhook URL is correct", () => {
      const url =
        typeof executor.operation.url === "function"
          ? executor.operation.url({ newRecord: {} })
          : executor.operation.url;
      expect(url).toBe("https://billing.example.com/webhooks/invoice");
    });

    test("webhook has vault Authorization header", () => {
      const { headers } = executor.operation;
      expect(headers.Authorization).toEqual({
        vault: "billing-service",
        key: "BILLING_API_KEY",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // subscriptionPlanChanged
  // ---------------------------------------------------------------------------
  describe("subscriptionPlanChanged executor", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/subscriptionPlanChanged.ts"));
      executor = mod.default;
    });

    test("name is subscription-plan-changed", () => {
      expect(executor.name).toBe("subscription-plan-changed");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is recordUpdated on Subscription", () => {
      expect(executor.trigger.kind).toBe("tailordb");
      expect(executor.trigger.events).toEqual(["tailordb.type_record.updated"]);
      expect(executor.trigger.typeName).toBe("Subscription");
    });

    test("condition: plan changed fires", () => {
      const { condition } = executor.trigger;
      expect(
        condition({
          newRecord: { plan: "BUSINESS" },
          oldRecord: { plan: "STARTER" },
        }),
      ).toBe(true);
    });

    test("condition: same plan does not fire", () => {
      const { condition } = executor.trigger;
      expect(
        condition({
          newRecord: { plan: "STARTER" },
          oldRecord: { plan: "STARTER" },
        }),
      ).toBe(false);
    });

    test("operation kind is graphql", () => {
      expect(executor.operation.kind).toBe("graphql");
    });

    test("graphql has query string containing mutation", () => {
      expect(typeof executor.operation.query).toBe("string");
      expect(executor.operation.query).toContain("mutation");
    });

    test("graphql has variables function", () => {
      expect(typeof executor.operation.variables).toBe("function");
      const vars = executor.operation.variables({ newRecord: { id: "s1", plan: "BUSINESS" } });
      expect(vars.input.subscriptionId).toBe("s1");
      expect(vars.input.newPlan).toBe("BUSINESS");
    });
  });

  // ---------------------------------------------------------------------------
  // monthlyBillingCycle
  // ---------------------------------------------------------------------------
  describe("monthlyBillingCycle executor", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      const mod = await importPath(path.join(workDir, "executors/monthlyBillingCycle.ts"));
      executor = mod.default;
    });

    test("name is monthly-billing-cycle", () => {
      expect(executor.name).toBe("monthly-billing-cycle");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger is schedule", () => {
      expect(executor.trigger.kind).toBe("schedule");
    });

    test("trigger cron is 0 0 1 * *", () => {
      expect(executor.trigger.cron).toBe("0 0 1 * *");
    });

    test("operation kind is workflow", () => {
      expect(executor.operation.kind).toBe("workflow");
    });

    test("operation has authInvoker with machineUserName", () => {
      expect(executor.operation.authInvoker).toBeDefined();
      expect(executor.operation.authInvoker.machineUserName).toBe("BILLING_WORKER");
    });
  });

  // ---------------------------------------------------------------------------
  // upgradeAuditLog
  // ---------------------------------------------------------------------------
  describe("upgradeAuditLog executor", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic module shape from importPath
    let executor: Record<string, any>;

    beforeAll(async () => {
      setupTailordbMock(() => []);
      const mod = await importPath(path.join(workDir, "executors/upgradeAuditLog.ts"));
      executor = mod.default;
      cleanupMocks();
    });

    test("name is upgrade-audit-log", () => {
      expect(executor.name).toBe("upgrade-audit-log");
    });

    test("has non-empty description", () => {
      expectNonEmptyDescription(executor);
    });

    test("trigger kind is resolverExecuted", () => {
      expect(executor.trigger.kind).toBe("resolverExecuted");
    });

    test("trigger references upgradeSubscription resolver", () => {
      expect(executor.trigger.resolverName).toBe("upgradeSubscription");
    });

    test("condition returns true when success=true", () => {
      const { condition } = executor.trigger;
      expect(condition({ success: true })).toBe(true);
    });

    test("condition returns false when success=false", () => {
      const { condition } = executor.trigger;
      expect(condition({ success: false })).toBe(false);
    });

    test("operation kind is graphql", () => {
      expect(executor.operation.kind).toBe("graphql");
    });

    test("graphql query contains mutation", () => {
      expect(typeof executor.operation.query).toBe("string");
      expect(executor.operation.query).toContain("mutation");
    });
  });

  // ===========================================================================
  // WORKFLOWS
  // ===========================================================================
  describe("billingCycle workflow", () => {
    test("collectUsage job name is collect-usage", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      expect(mod.collectUsage.name).toBe("collect-usage");
    });

    test("calculateCharges job name is calculate-charges", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      expect(mod.calculateCharges.name).toBe("calculate-charges");
    });

    test("processBilling job name is process-billing", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      expect(mod.processBilling.name).toBe("process-billing");
    });

    test("workflow name is billing-cycle", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      expect(mod.default.name).toBe("billing-cycle");
    });

    test("has default export (workflow)", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      expect(mod.default).toBeDefined();
      expect(mod.default.name).toBeDefined();
      expect(mod.default.mainJob).toBeDefined();
    });

    test("all 3 jobs are named exports", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      expect(mod.collectUsage).toBeDefined();
      expect(mod.calculateCharges).toBeDefined();
      expect(mod.processBilling).toBeDefined();
    });

    test("collectUsage returns mock data", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.collectUsage.body({
        organizationId: "org-1",
        billingPeriod: { start: "2026-01-01", end: "2026-01-31" },
      });
      expect(result.usageItems).toBeDefined();
      expect(Array.isArray(result.usageItems)).toBe(true);
      expect(result.totalItems).toBeGreaterThan(0);
    });

    test("calculateCharges: baseCharge equals monthlyRate", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.calculateCharges.body({
        usageItems: [{ metric: "api-calls", totalQuantity: 50 }],
        plan: "STARTER",
        monthlyRate: 29.99,
      });
      expect(result.baseCharge).toBe(29.99);
    });

    test("calculateCharges: FREE plan overage threshold is 100", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.calculateCharges.body({
        usageItems: [{ metric: "api-calls", totalQuantity: 150 }],
        plan: "FREE",
        monthlyRate: 0,
      });
      // 150 - 100 = 50, 50 * 0.01 = 0.5
      expect(result.overageCharge).toBeCloseTo(0.5);
    });

    test("calculateCharges: STARTER plan overage threshold is 1000", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.calculateCharges.body({
        usageItems: [{ metric: "api-calls", totalQuantity: 1500 }],
        plan: "STARTER",
        monthlyRate: 29.99,
      });
      // 1500 - 1000 = 500, 500 * 0.01 = 5.0
      expect(result.overageCharge).toBeCloseTo(5.0);
      expect(result.totalCharge).toBeCloseTo(34.99);
    });

    test("calculateCharges: BUSINESS plan overage threshold is 10000", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.calculateCharges.body({
        usageItems: [{ metric: "api-calls", totalQuantity: 10500 }],
        plan: "BUSINESS",
        monthlyRate: 99.99,
      });
      // 10500 - 10000 = 500, 500 * 0.01 = 5.0
      expect(result.overageCharge).toBeCloseTo(5.0);
      expect(result.totalCharge).toBeCloseTo(104.99);
    });

    test("calculateCharges: ENTERPRISE plan has no overage", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.calculateCharges.body({
        usageItems: [{ metric: "api-calls", totalQuantity: 999999 }],
        plan: "ENTERPRISE",
        monthlyRate: 299.99,
      });
      expect(result.overageCharge).toBe(0);
      expect(result.totalCharge).toBe(299.99);
    });

    test("calculateCharges: totalCharge = baseCharge + overageCharge", async () => {
      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = mod.calculateCharges.body({
        usageItems: [
          { metric: "api-calls", totalQuantity: 200 },
          { metric: "storage", totalQuantity: 300 },
        ],
        plan: "FREE",
        monthlyRate: 0,
      });
      // api-calls: (200-100)*0.01 = 1.0, storage: (300-100)*0.01 = 2.0
      expect(result.overageCharge).toBeCloseTo(3.0);
      expect(result.totalCharge).toBeCloseTo(result.baseCharge + result.overageCharge);
    });

    test("processBilling orchestrates correctly", async () => {
      setupWorkflowMock((jobName, args) => {
        if (jobName === "collect-usage") {
          return {
            usageItems: [{ metric: "api-calls", totalQuantity: 500 }],
            totalItems: 1,
          };
        }
        if (jobName === "calculate-charges") {
          const typedArgs = args as { monthlyRate: number };
          return {
            baseCharge: typedArgs.monthlyRate,
            overageCharge: 0,
            totalCharge: typedArgs.monthlyRate,
          };
        }
        return {};
      });

      const mod = await importPath(path.join(workDir, "workflows/billingCycle.ts"));
      const result = await mod.processBilling.body({
        organizationId: "org-1",
        plan: "BUSINESS",
        monthlyRate: 99.99,
        billingPeriod: { start: "2026-01-01", end: "2026-01-31" },
      });

      expect(result.success).toBe(true);
      expect(result.organizationId).toBe("org-1");
      expect(result.totalCharge).toBe(99.99);
      expect(result.usageSummary).toBeDefined();
      expect(result.billingPeriod).toBeDefined();

      cleanupMocks();
    });
  });

  // ===========================================================================
  // CONFIG
  // ===========================================================================
  describe("tailor.config.ts", () => {
    test("config name is saas-platform", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.name).toBe("saas-platform");
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

    test("has workflow configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.workflow).toBeDefined();
    });

    test("has auth configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth).toBeDefined();
    });

    test("auth userProfile.usernameField is contactEmail", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth.userProfile.usernameField).toBe("contactEmail");
    });

    test("auth has 3 machine users", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const machineUsers = mod.default.auth.machineUsers;
      expect(machineUsers).toBeDefined();
      expect(Object.keys(machineUsers).length).toBe(3);
    });

    test("machine users include BILLING_WORKER, ADMIN_SERVICE, ANALYTICS", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const names = Object.keys(mod.default.auth.machineUsers);
      expect(names).toContain("BILLING_WORKER");
      expect(names).toContain("ADMIN_SERVICE");
      expect(names).toContain("ANALYTICS");
    });

    test("auth has 2 oauth2 clients", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const clients = mod.default.auth.oauth2Clients;
      expect(Object.keys(clients).length).toBe(2);
    });

    test("has idp configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.idp).toBeDefined();
      expect(Array.isArray(mod.default.idp)).toBe(true);
    });

    test("idp password policy requires min 10 length", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const firstIdp = mod.default.idp[0];
      expect(firstIdp.userAuthPolicy.passwordMinLength).toBeGreaterThanOrEqual(10);
    });

    test("idp password policy requires upper, lower, numeric, non-alpha", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const policy = mod.default.idp[0].userAuthPolicy;
      expect(policy.passwordRequireUppercase).toBe(true);
      expect(policy.passwordRequireLowercase).toBe(true);
      expect(policy.passwordRequireNumeric).toBe(true);
      expect(policy.passwordRequireNonAlphanumeric).toBe(true);
    });

    test("has staticWebsites with dashboard", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.staticWebsites).toBeDefined();
      const websites = mod.default.staticWebsites as { name: string }[];
      const dashboard = websites.find((w) => w.name.includes("dashboard"));
      expect(dashboard, "expected a website with name containing 'dashboard'").toBeDefined();
    });

    test("generators named export exists", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.generators).toBeDefined();
      expect(Array.isArray(mod.generators)).toBe(true);
    });

    test("generators include kysely-type and seed", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const generatorNames = mod.generators.map((g: [string, unknown]) => g[0]);
      expect(generatorNames).toContain("@tailor-platform/kysely-type");
      expect(generatorNames).toContain("@tailor-platform/seed");
    });

    test("seed generator references ADMIN_SERVICE machine user", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const seedGen = mod.generators.find(
        (g: [string, unknown]) => g[0] === "@tailor-platform/seed",
      );
      expect(seedGen).toBeDefined();
      const seedConfig = seedGen[1] as { machineUserName: string };
      expect(seedConfig.machineUserName).toBe("ADMIN_SERVICE");
    });
  });
});
