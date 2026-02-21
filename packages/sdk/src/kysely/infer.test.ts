// Side-effect import: triggers module augmentation (AttributeMap.role) for example models
import type {} from "../../../../example/user-defined";
import { describe, it, expectTypeOf } from "vitest";
import { db } from "@/configure/services/tailordb/schema";
import { type event } from "../../../../example/analyticsdb/event";
import { type customer } from "../../../../example/tailordb/customer";
import { type invoice } from "../../../../example/tailordb/invoice";
import { type nestedProfile } from "../../../../example/tailordb/nested";
import { type purchaseOrder } from "../../../../example/tailordb/purchaseOrder";
import { type salesOrder, type salesOrderCreated } from "../../../../example/tailordb/salesOrder";
import { type selfie } from "../../../../example/tailordb/selfie";
import { type supplier } from "../../../../example/tailordb/supplier";
import { type user } from "../../../../example/tailordb/user";
import { type userLog } from "../../../../example/tailordb/userLog";
import { type userSetting } from "../../../../example/tailordb/userSetting";
import type { Generated, Serial, Timestamp } from "./index";
import type { InferTable, InferNamespace, EnumRecord } from "./infer";

// === Example model imports for golden tests ===

describe("InferTable basic field types", () => {
  it("maps string fields to string", () => {
    const t = db.type("T", { name: db.string() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string;
    }>();
  });

  it("maps uuid fields to string", () => {
    const t = db.type("T", { ref: db.uuid() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      ref: string;
    }>();
  });

  it("maps integer fields to number", () => {
    const t = db.type("T", { count: db.int() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      count: number;
    }>();
  });

  it("maps float fields to number", () => {
    const t = db.type("T", { price: db.float() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      price: number;
    }>();
  });

  it("maps boolean fields to boolean", () => {
    const t = db.type("T", { active: db.bool() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      active: boolean;
    }>();
  });

  it("maps date fields to Timestamp", () => {
    const t = db.type("T", { birth: db.date() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      birth: Timestamp;
    }>();
  });

  it("maps datetime fields to Timestamp", () => {
    const t = db.type("T", { ts: db.datetime() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      ts: Timestamp;
    }>();
  });

  it("maps time fields to string", () => {
    const t = db.type("T", { open: db.time() });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      open: string;
    }>();
  });

  it("maps enum fields to literal union", () => {
    const t = db.type("T", { role: db.enum(["MANAGER", "STAFF"]) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      role: "MANAGER" | "STAFF";
    }>();
  });
});

describe("InferTable optional modifier", () => {
  it("maps optional string to string | null", () => {
    const t = db.type("T", { name: db.string({ optional: true }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string | null;
    }>();
  });

  it("maps optional datetime to Timestamp | null", () => {
    const t = db.type("T", { ts: db.datetime({ optional: true }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      ts: Timestamp | null;
    }>();
  });

  it("maps optional enum to literal union | null", () => {
    const t = db.type("T", { s: db.enum(["a", "b"], { optional: true }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      s: "a" | "b" | null;
    }>();
  });
});

describe("InferTable array modifier", () => {
  it("maps array string to string[]", () => {
    const t = db.type("T", { tags: db.string({ array: true }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      tags: string[];
    }>();
  });

  it("maps optional array to type[] | null", () => {
    const t = db.type("T", { ids: db.uuid({ optional: true, array: true }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      ids: string[] | null;
    }>();
  });
});

describe("InferTable serial modifier", () => {
  it("maps string serial to Serial<string>", () => {
    const t = db.type("T", { code: db.string().serial({ start: 1 }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      code: Serial<string>;
    }>();
  });

  it("maps integer serial to Serial<number>", () => {
    const t = db.type("T", { seq: db.int().serial({ start: 1 }) });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      seq: Serial<number>;
    }>();
  });
});

describe("InferTable hooks modifier (field-level)", () => {
  it("maps field with create hook to Generated", () => {
    const t = db.type("T", {
      computed: db.string().hooks({ create: () => "x" }),
    });
    // @ts-ignore -- tsgo: conditional type WithGenerated not resolved for field intersection types
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      computed: Generated<string>;
    }>();
  });

  it("update-only hook does not add Generated", () => {
    const t = db.type("T", {
      updated: db.string({ optional: true }).hooks({ update: () => "x" }),
    });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      updated: string | null;
    }>();
  });

  it("maps datetime with create hook to Generated<Timestamp>", () => {
    const t = db.type("T", {
      createdAt: db.datetime().hooks({ create: () => new Date() }),
    });
    // @ts-ignore -- tsgo: conditional type WithGenerated not resolved for field intersection types
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      createdAt: Generated<Timestamp>;
    }>();
  });
});

describe("InferTable type-level hooks (TailorDBType.hooks())", () => {
  it("type-level hooks propagate create hook to Generated", () => {
    const t = db
      .type("T", {
        fullAddress: db.string(),
        name: db.string(),
      })
      .hooks({
        fullAddress: {
          create: () => "computed",
          update: () => "computed",
        },
      });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      fullAddress: Generated<string>;
      name: string;
    }>();
  });
});

describe("InferTable nested object", () => {
  it("maps simple nested object", () => {
    const t = db.type("T", {
      info: db.object({
        name: db.string(),
        age: db.int({ optional: true }),
      }),
    });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      info: {
        name: string;
        age: number | null;
      };
    }>();
  });

  it("maps nested object with datetime to Timestamp", () => {
    const t = db.type("T", {
      meta: db.object({
        created: db.datetime(),
        updated: db.datetime({ optional: true }),
      }),
    });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      meta: {
        created: Timestamp;
        updated: Timestamp | null;
      };
    }>();
  });

  it("maps nested array object", () => {
    const t = db.type("T", {
      items: db.object(
        {
          id: db.uuid(),
          name: db.string(),
        },
        { array: true },
      ),
    });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      items: {
        id: string;
        name: string;
      }[];
    }>();
  });

  it("maps nested with enum", () => {
    const t = db.type("T", {
      files: db.object(
        {
          id: db.uuid(),
          name: db.string(),
          size: db.int(),
          type: db.enum(["text", "image"]),
        },
        { array: true },
      ),
    });
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      files: {
        id: string;
        name: string;
        size: number;
        type: "text" | "image";
      }[];
    }>();
  });
});

describe("InferTable timestamps helper", () => {
  it("maps db.fields.timestamps() correctly", () => {
    const t = db.type("T", {
      name: db.string(),
      ...db.fields.timestamps(),
    });
    // @ts-ignore -- tsgo: conditional type WithGenerated not resolved for field intersection types
    expectTypeOf<InferTable<typeof t>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("InferNamespace", () => {
  it("infers namespace with multiple types", () => {
    const typeA = db.type("A", { name: db.string() });
    const typeB = db.type("B", { count: db.int() });
    type NS = InferNamespace<{ A: typeof typeA; B: typeof typeB }>;
    expectTypeOf<NS>().toEqualTypeOf<{
      A: { id: Generated<string>; name: string };
      B: { id: Generated<string>; count: number };
    }>();
  });
});

describe("EnumRecord", () => {
  it("infers readonly record from enum field", () => {
    const role = db.enum(["MANAGER", "STAFF"]);
    expectTypeOf<EnumRecord<typeof role>>().toEqualTypeOf<{
      readonly MANAGER: "MANAGER";
      readonly STAFF: "STAFF";
    }>();
  });

  it("works with optional enum", () => {
    const status = db.enum(["active", "inactive"], { optional: true });
    expectTypeOf<EnumRecord<typeof status>>().toEqualTypeOf<{
      readonly active: "active";
      readonly inactive: "inactive";
    }>();
  });

  it("works with enum defined using objects", () => {
    const priority = db.enum([{ value: "high", description: "High priority" }, "low"]);
    expectTypeOf<EnumRecord<typeof priority>>().toEqualTypeOf<{
      readonly high: "high";
      readonly low: "low";
    }>();
  });
});

// === Golden tests against example models ===
// Each test verifies InferTable matches the manually generated type in example/generated/tailordb.ts

describe("Golden test: Customer", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof customer>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string;
      email: string;
      phone: string | null;
      country: string;
      postalCode: string;
      address: string | null;
      city: string | null;
      fullAddress: Generated<string>;
      state: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: Invoice", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof invoice>>().toEqualTypeOf<{
      id: Generated<string>;
      invoiceNumber: Serial<string>;
      salesOrderID: string;
      amount: number | null;
      sequentialId: Serial<number>;
      status: "draft" | "sent" | "paid" | "cancelled" | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: User", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof user>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string;
      email: string;
      status: string | null;
      department: string | null;
      role: "MANAGER" | "STAFF";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: Supplier", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof supplier>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string;
      phone: string;
      fax: string | null;
      email: string | null;
      postalCode: string;
      country: string;
      state: "Alabama" | "Alaska";
      city: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: SalesOrder", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof salesOrder>>().toEqualTypeOf<{
      id: Generated<string>;
      customerID: string;
      approvedByUserIDs: string[] | null;
      totalPrice: number | null;
      discount: number | null;
      status: string | null;
      cancelReason: string | null;
      canceledAt: Timestamp | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: SalesOrderCreated", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof salesOrderCreated>>().toEqualTypeOf<{
      id: Generated<string>;
      salesOrderID: string;
      customerID: string;
      totalPrice: number | null;
      status: string | null;
    }>();
  });
});

describe("Golden test: PurchaseOrder", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof purchaseOrder>>().toEqualTypeOf<{
      id: Generated<string>;
      supplierID: string;
      totalPrice: number;
      discount: number | null;
      status: string;
      attachedFiles: {
        id: string;
        name: string;
        size: number;
        type: "text" | "image";
      }[];
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: Selfie", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof selfie>>().toEqualTypeOf<{
      id: Generated<string>;
      name: string;
      parentID: string | null;
      dependId: string | null;
    }>();
  });
});

describe("Golden test: UserLog", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof userLog>>().toEqualTypeOf<{
      id: Generated<string>;
      userID: string;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: UserSetting", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof userSetting>>().toEqualTypeOf<{
      id: Generated<string>;
      language: "jp" | "en";
      userID: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: NestedProfile", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof nestedProfile>>().toEqualTypeOf<{
      id: Generated<string>;
      userInfo: {
        name: string;
        age: number | null;
        bio: string | null;
        email: string;
        phone: string | null;
      };
      metadata: {
        created: Timestamp;
        lastUpdated: Timestamp | null;
        version: number;
      };
      archived: boolean | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});

describe("Golden test: Event (analyticsdb)", () => {
  it("matches generated type", () => {
    // @ts-ignore -- tsgo: TailorDBField description() this-parameter breaks structural compatibility
    expectTypeOf<InferTable<typeof event>>().toEqualTypeOf<{
      id: Generated<string>;
      name: "CLICK" | "VIEW" | "PURCHASE";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }>();
  });
});
