import { db, t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const UserChangeRequest = db.type(["UserChangeRequest", "UserChangeRequests"], {
  recordId: db.uuid().index(),
  draft: db.uuid().index(),
  status: db.enum(["RUNNING", "REWORK", "APPROVED", "REJECTED", "CANCELED"]).index(),
  reworkIteration: db.int(),
  currentStepNo: db.int().hooks({ create: () => 1 }).validate([({ value }) => value >= 1, "currentStepNo must be >= 1"]),
  templateKey: db.string(),
  templateVersion: db.int(),
  requestedBy: db.uuid().index(),
  requestedAt: db.datetime(),
  finalizedAt: db.datetime({ optional: true }),
  effectiveFrom: db.datetime(),
  activationStatus: db.enum(["PENDING", "ACTIVATED"]).index(),
  activatedAt: db.datetime({ optional: true }),
  ...db.fields.timestamps(),
}).description("Approval request for change management").indexes({ fields: ["recordId", "status"], name: "request_record_status_idx" }).permission({ create: [[{ user: "_loggedIn" }, "=", true]], read: [[{ user: "_loggedIn" }, "=", true]], update: [[{ user: "_loggedIn" }, "=", true]], delete: [[{ user: "_loggedIn" }, "=", true]] }).gqlPermission([{ conditions: [[{ user: "_loggedIn" }, "=", true]], actions: ["read"], permit: true }]);

const UserChangeReworkEvent = db.type(["UserChangeReworkEvent", "UserChangeReworkEvents"], {
  request: db.uuid().index().relation({ type: "n-1", toward: { type: UserChangeRequest } }),
  iteration: db.int(),
  fromStepNo: db.int(),
  requestedBy: db.uuid().index(),
  requestedAt: db.datetime(),
  reason: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

const schemaType = t.object({
  ...UserChangeReworkEvent.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeReworkEvent.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeReworkEvent);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"request","references":{"table":"UserChangeRequest","column":"id"}},
    ],
  }
);
