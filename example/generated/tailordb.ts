import { type ColumnType, Kysely, type KyselyConfig } from "kysely";
import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
type Serial<T = string | number> = ColumnType<T, never, never>;

export interface Namespace {
  "tailordb": {
    Customer: {
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
    }

    Invoice: {
      id: Generated<string>;
      invoiceNumber: Serial<string>;
      salesOrderID: string;
      amount: number | null;
      sequentialId: Serial<number>;
      status: "draft" | "sent" | "paid" | "cancelled" | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    NestedProfile: {
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
    }

    PurchaseOrder: {
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
    }

    SalesOrder: {
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
    }

    SalesOrderCreated: {
      id: Generated<string>;
      salesOrderID: string;
      customerID: string;
      totalPrice: number | null;
      status: string | null;
    }

    Selfie: {
      id: Generated<string>;
      name: string;
      parentID: string | null;
      dependId: string | null;
    }

    Supplier: {
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
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      status: string | null;
      department: string | null;
      role: "MANAGER" | "STAFF";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
      recordId: string;
      recordState: "DRAFT" | "ACTIVE" | "ARCHIVED";
      archivedSeq: number;
      effectiveFrom: Timestamp;
      effectiveTo: Timestamp | null;
      requestedBy: string;
      requestedAt: Timestamp;
      currentApprover: string | null;
      approvers: string[];
    }

    UserChangeRequest: {
      id: Generated<string>;
      recordId: string;
      draft: string;
      status: "RUNNING" | "REWORK" | "APPROVED" | "REJECTED" | "CANCELED";
      reworkIteration: number;
      currentStepNo: number;
      templateKey: string;
      templateVersion: number;
      requestedBy: string;
      requestedAt: Timestamp;
      finalizedAt: Timestamp | null;
      effectiveFrom: Timestamp;
      activationStatus: "PENDING" | "ACTIVATED";
      activatedAt: Timestamp | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    UserChangeStep: {
      id: Generated<string>;
      request: string;
      iteration: number;
      stepNo: number;
      stepName: string;
      quorumType: "ALL" | "ANY";
      minApprovals: number | null;
      status: "PENDING" | "APPROVED" | "REWORK" | "REJECTED" | "SKIPPED";
      startedAt: Timestamp;
      finishedAt: Timestamp | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    UserChangeApproval: {
      id: Generated<string>;
      request: string;
      iteration: number;
      stepNo: number;
      approver: string;
      decision: "PENDING" | "APPROVED" | "REWORK" | "REJECTED";
      decidedAt: Timestamp | null;
      comment: string | null;
      resolvedByRuleType: "USER" | "GROUP" | "ROLE" | "ORG_MANAGER";
      resolvedByRuleValue: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    UserChangeReworkEvent: {
      id: Generated<string>;
      request: string;
      iteration: number;
      fromStepNo: number;
      requestedBy: string;
      requestedAt: Timestamp;
      reason: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    UserLog: {
      id: Generated<string>;
      userID: string;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    UserSetting: {
      id: Generated<string>;
      language: "jp" | "en";
      userID: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }
  },
  "analyticsdb": {
    Event: {
      id: Generated<string>;
      name: "CLICK" | "VIEW" | "PURCHASE";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }
  }
}

export function getDB<const N extends keyof Namespace>(
  namespace: N,
  kyselyConfig?: Omit<KyselyConfig, "dialect">,
): Kysely<Namespace[N]> {
  const client = new tailordb.Client({ namespace });
  return new Kysely<Namespace[N]>({
    dialect: new TailordbDialect(client),
    ...kyselyConfig,
  });
}

export type DB<N extends keyof Namespace = keyof Namespace> = ReturnType<typeof getDB<N>>;
