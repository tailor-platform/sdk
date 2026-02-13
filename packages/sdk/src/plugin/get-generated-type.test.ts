import { describe, expect, it } from "vitest";
import { db } from "@/configure/services/tailordb";
import changesetPlugin from "./builtin/changeset";
import { getGeneratedType } from "./get-generated-type";

describe("getGeneratedType", () => {
  describe("type-attached plugins", () => {
    it("returns generated type for changeset plugin", () => {
      const sourceType = db.type("Customer", {
        name: db.string(),
        email: db.string(),
      });

      const requestType = getGeneratedType(changesetPlugin, sourceType, "request");

      expect(requestType.name).toBe("CustomerChangeRequest");
      expect(requestType.fields).toBeDefined();
      expect(requestType.fields.recordId).toBeDefined();
      expect(requestType.fields.status).toBeDefined();
    });

    it("returns different generated types for different kinds", () => {
      const sourceType = db.type("Order", {
        amount: db.int(),
      });

      const request = getGeneratedType(changesetPlugin, sourceType, "request");
      const step = getGeneratedType(changesetPlugin, sourceType, "step");
      const approval = getGeneratedType(changesetPlugin, sourceType, "approval");
      const rework = getGeneratedType(changesetPlugin, sourceType, "rework");

      expect(request.name).toBe("OrderChangeRequest");
      expect(step.name).toBe("OrderChangeStep");
      expect(approval.name).toBe("OrderChangeApproval");
      expect(rework.name).toBe("OrderChangeReworkEvent");
    });

    it("caches process() results for the same sourceType", () => {
      const sourceType = db.type("Product", {
        name: db.string(),
      });

      const first = getGeneratedType(changesetPlugin, sourceType, "request");
      const second = getGeneratedType(changesetPlugin, sourceType, "step");

      // Both calls should return types from the same process() call (cached)
      expect(first.name).toBe("ProductChangeRequest");
      expect(second.name).toBe("ProductChangeStep");
    });

    it("throws error for invalid kind", () => {
      const sourceType = db.type("Test", {
        name: db.string(),
      });

      expect(() => getGeneratedType(changesetPlugin, sourceType, "invalid")).toThrow(
        /Generated type not found/,
      );
    });

    it("throws error for plugin without process() method", () => {
      const namespaceOnlyPlugin = {
        id: "namespace-only",
        description: "Namespace only plugin",
        importPath: "@example/namespace",
        processNamespace: () => ({ types: {} }),
      };

      const sourceType = db.type("Test", { name: db.string() });

      expect(() => getGeneratedType(namespaceOnlyPlugin, sourceType, "test")).toThrow(
        /does not have a process\(\) method/,
      );
    });
  });

  describe("namespace plugins", () => {
    it("returns generated type for namespace plugin", () => {
      const namespacePlugin = {
        id: "audit-plugin",
        description: "Audit plugin",
        importPath: "@example/audit",
        processNamespace: () => ({
          types: {
            auditLog: db.type("AuditLog", {
              message: db.string(),
              timestamp: db.datetime(),
            }),
          },
        }),
      };

      const auditLogType = getGeneratedType(namespacePlugin, null, "auditLog");

      expect(auditLogType.name).toBe("AuditLog");
      expect(auditLogType.fields.message).toBeDefined();
    });

    it("throws error for plugin without processNamespace() method", () => {
      const typeOnlyPlugin = {
        id: "type-only",
        description: "Type only plugin",
        importPath: "@example/type",
        configSchema: { type: "bool" } as never,
        process: () => ({ types: {} }),
      };

      expect(() => getGeneratedType(typeOnlyPlugin, null, "test")).toThrow(
        /does not have a processNamespace\(\) method/,
      );
    });
  });
});
