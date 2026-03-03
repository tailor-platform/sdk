import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  createWorkDirContext,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  expectEnumValues,
  importPath,
} from "../../../shared/test-helpers.js";

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

describe.skipIf(!workDirReady)("002-project-management", () => {
  // ===========================================================================
  // MODELS
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Team
  // ---------------------------------------------------------------------------
  describe("Team model", () => {
    test("model name is Team", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expect(mod.team.name).toBe("Team");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expectFieldNames(mod.team, [
        "name",
        "code",
        "description",
        "maxMembers",
        "isActive",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("name is string required and unique", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expectFieldType(mod.team.fields.name, "string", { required: true, unique: true });
    });

    test("code is string with serial config TEAM-%03d", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const field = mod.team.fields.code;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.format).toBe("TEAM-%03d");
    });

    test("code serial start is 1", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expect(mod.team.fields.code.metadata.serial.start).toBe(1);
    });

    test("description is string optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expectFieldType(mod.team.fields.description, "string", { required: false });
    });

    test("maxMembers is int type", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expect(mod.team.fields.maxMembers.type).toBe("integer");
    });

    test("maxMembers validation accepts positive values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const validate = mod.team.fields.maxMembers.metadata.validate;
      expect(validate).toBeDefined();
      const fn = extractValidateFn(validate);
      expect(fn({ value: 5, data: {}, user: {} })).toBe(true);
    });

    test("maxMembers validation rejects zero", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const fn = extractValidateFn(mod.team.fields.maxMembers.metadata.validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(false);
    });

    test("maxMembers validation rejects negative", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const fn = extractValidateFn(mod.team.fields.maxMembers.metadata.validate);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
    });

    test("maxMembers create hook defaults to 10", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.maxMembers.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBe(10);
    });

    test("maxMembers create hook preserves provided value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.maxMembers.metadata.hooks?.create;
      expect(hook({ value: 25, data: {}, user: {} })).toBe(25);
    });

    test("isActive create hook defaults to true", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.isActive.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBe(true);
    });

    test("isActive create hook preserves false", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.isActive.metadata.hooks?.create;
      expect(hook({ value: false, data: {}, user: {} })).toBe(false);
    });

    test("maxMembers create hook: null defaults to 10", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.maxMembers.metadata.hooks?.create;
      expect(hook({ value: null, data: {}, user: {} })).toBe(10);
    });

    test("maxMembers create hook: explicit 0 is preserved", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.maxMembers.metadata.hooks?.create;
      expect(hook({ value: 0, data: {}, user: {} })).toBe(0);
    });

    test("isActive create hook: null defaults to true", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const hook = mod.team.fields.isActive.metadata.hooks?.create;
      expect(hook({ value: null, data: {}, user: {} })).toBe(true);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expectTimestamps(mod.team);
    });

    test("has non-empty description", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      expect(mod.team.metadata.description).toBeDefined();
      expect(mod.team.metadata.description.length).toBeGreaterThan(0);
    });

    test("has permission with create/read/update/delete", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const permission = mod.team.metadata.permissions?.record;
      expect(permission).toBeDefined();
      expect(permission.create).toBeDefined();
      expect(permission.read).toBeDefined();
      expect(permission.update).toBeDefined();
      expect(permission.delete).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Member
  // ---------------------------------------------------------------------------
  describe("Member model", () => {
    test("model name is Member", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expect(mod.member.name).toBe("Member");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expectFieldNames(mod.member, [
        "name",
        "email",
        "role",
        "teamId",
        "joinedAt",
        "skills",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("name is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expectFieldType(mod.member.fields.name, "string", { required: true });
    });

    test("email is string unique", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expectFieldType(mod.member.fields.email, "string", { unique: true });
    });

    test("email create hook lowercases value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const hook = mod.member.fields.email.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: "HELLO@Example.COM", data: {}, user: {} })).toBe("hello@example.com");
    });

    test("email create hook returns falsy for null", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const hook = mod.member.fields.email.metadata.hooks?.create;
      const result = hook({ value: null, data: {}, user: {} });
      expect(!result).toBe(true);
    });

    test("email update hook exists and lowercases value", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const hook = mod.member.fields.email.metadata.hooks?.update;
      expect(hook).toBeDefined();
      expect(hook({ value: "FOO@BAR.COM", data: {}, user: {} })).toBe("foo@bar.com");
    });

    test("email update hook returns falsy for null", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const hook = mod.member.fields.email.metadata.hooks?.update;
      const result = hook({ value: null, data: {}, user: {} });
      expect(!result).toBe(true);
    });

    test("role is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expectEnumValues(mod.member.fields.role, ["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
    });

    test("role enum values have descriptions", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const allowedValues = mod.member.fields.role.metadata.allowedValues;
      for (const entry of allowedValues) {
        expect(
          entry.description,
          `expected description for enum value "${entry.value}"`,
        ).toBeDefined();
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });

    test("teamId has n-1 relation to Team", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const field = mod.member.fields.teamId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Team");
    });

    test("joinedAt create hook returns Date instance", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const hook = mod.member.fields.joinedAt.metadata.hooks?.create;
      expect(hook).toBeDefined();
      const result = hook({ value: undefined, data: {}, user: {} });
      expect(result).toBeInstanceOf(Date);
    });

    test("skills is string array optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      const field = mod.member.fields.skills;
      expect(field.type).toBe("string");
      expect(field.metadata.array).toBe(true);
      expect(field.metadata.required).toBe(false);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expectTimestamps(mod.member);
    });
  });

  // ---------------------------------------------------------------------------
  // Project
  // ---------------------------------------------------------------------------
  describe("Project model", () => {
    test("model name is Project", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expect(mod.project.name).toBe("Project");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectFieldNames(mod.project, [
        "name",
        "code",
        "description",
        "status",
        "teamId",
        "priority",
        "budget",
        "startDate",
        "endDate",
        "settings",
        "tags",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("name is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectFieldType(mod.project.fields.name, "string", { required: true });
    });

    test("code is string with serial config PRJ-%04d", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const field = mod.project.fields.code;
      expect(field.type).toBe("string");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.format).toBe("PRJ-%04d");
    });

    test("description is string optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectFieldType(mod.project.fields.description, "string", { required: false });
    });

    test("status is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectEnumValues(mod.project.fields.status, [
        "PLANNING",
        "ACTIVE",
        "ON_HOLD",
        "COMPLETED",
        "ARCHIVED",
      ]);
    });

    test("teamId has n-1 relation to Team", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const field = mod.project.fields.teamId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Team");
    });

    test("priority is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectEnumValues(mod.project.fields.priority, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    });

    test("budget is float optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expect(mod.project.fields.budget.type).toBe("float");
      expect(mod.project.fields.budget.metadata.required).toBe(false);
    });

    test("budget validation accepts zero", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const fn = extractValidateFn(mod.project.fields.budget.metadata.validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
    });

    test("budget validation accepts positive", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const fn = extractValidateFn(mod.project.fields.budget.metadata.validate);
      expect(fn({ value: 100, data: {}, user: {} })).toBe(true);
    });

    test("budget validation rejects negative", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const fn = extractValidateFn(mod.project.fields.budget.metadata.validate);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
    });

    test("startDate is date required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectFieldType(mod.project.fields.startDate, "date", { required: true });
    });

    test("endDate is date optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectFieldType(mod.project.fields.endDate, "date", { required: false });
    });

    test("settings is nested object with 3 sub-fields", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const settings = mod.project.fields.settings;
      expect(settings.type).toBe("nested");
      const subFieldNames = Object.keys(settings.fields);
      expect(subFieldNames).toContain("isPublic");
      expect(subFieldNames).toContain("allowExternalAccess");
      expect(subFieldNames).toContain("defaultAssignee");
    });

    test("settings sub-field types are correct", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const f = mod.project.fields.settings.fields;
      expect(f.isPublic.type).toBe("boolean");
      expect(f.allowExternalAccess.type).toBe("boolean");
      expect(f.defaultAssignee.type).toBe("string");
    });

    test("tags is string array optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const field = mod.project.fields.tags;
      expect(field.type).toBe("string");
      expect(field.metadata.array).toBe(true);
      expect(field.metadata.required).toBe(false);
    });

    test("has composite index on teamId and status", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      const indexes = mod.project.metadata.indexes;
      expect(indexes).toBeDefined();
      const indexEntries = Object.values(indexes) as { fields: string[] }[];
      const compositeIdx = indexEntries.find(
        (idx) => idx.fields.includes("teamId") && idx.fields.includes("status"),
      );
      expect(compositeIdx, "expected composite index on teamId and status").toBeDefined();
    });

    test("has aggregation feature", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expect(mod.project.metadata.settings?.aggregation).toBe(true);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/project.ts"));
      expectTimestamps(mod.project);
    });
  });

  // ---------------------------------------------------------------------------
  // Task
  // ---------------------------------------------------------------------------
  describe("Task model", () => {
    test("model name is Task", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.name).toBe("Task");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expectFieldNames(mod.task, [
        "title",
        "taskNumber",
        "projectId",
        "assigneeId",
        "status",
        "priority",
        "estimatedHours",
        "parentTaskId",
        "dueDate",
        "completedAt",
        "createdAt",
        "updatedAt",
      ]);
    });

    test("title is string required", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expectFieldType(mod.task.fields.title, "string", { required: true });
    });

    test("taskNumber is int with serial config", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const field = mod.task.fields.taskNumber;
      expect(field.type).toBe("integer");
      expect(field.metadata.serial).toBeDefined();
      expect(field.metadata.serial.start).toBe(1);
    });

    test("projectId has n-1 relation to Project", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const field = mod.task.fields.projectId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Project");
    });

    test("assigneeId has n-1 relation to Member", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const field = mod.task.fields.assigneeId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Member");
    });

    test("assigneeId is optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.fields.assigneeId.metadata.required).toBe(false);
    });

    test("status is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expectEnumValues(mod.task.fields.status, ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
    });

    test("priority is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expectEnumValues(mod.task.fields.priority, ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    });

    test("estimatedHours is float optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.fields.estimatedHours.type).toBe("float");
      expect(mod.task.fields.estimatedHours.metadata.required).toBe(false);
    });

    test("estimatedHours validation accepts positive", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const fn = extractValidateFn(mod.task.fields.estimatedHours.metadata.validate);
      expect(fn({ value: 5, data: {}, user: {} })).toBe(true);
    });

    test("estimatedHours validation rejects zero", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const fn = extractValidateFn(mod.task.fields.estimatedHours.metadata.validate);
      expect(fn({ value: 0, data: {}, user: {} })).toBe(false);
    });

    test("estimatedHours validation rejects negative", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const fn = extractValidateFn(mod.task.fields.estimatedHours.metadata.validate);
      expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
    });

    test("parentTaskId has n-1 self-referencing relation", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const field = mod.task.fields.parentTaskId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      // Self-referencing relations resolve to either "self" or the type name
      const towardType = field.rawRelation.toward.type;
      expect(towardType === "self" || towardType === "Task").toBe(true);
    });

    test("parentTaskId is optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.fields.parentTaskId.metadata.required).toBe(false);
    });

    test("dueDate is date optional", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expectFieldType(mod.task.fields.dueDate, "date", { required: false });
    });

    test("completedAt update hook sets Date when status is DONE", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const hook = mod.task.fields.completedAt.metadata.hooks?.update;
      expect(hook).toBeDefined();
      const result = hook({ value: null, data: { status: "DONE" }, user: {} });
      expect(result).toBeInstanceOf(Date);
    });

    test("completedAt update hook preserves value when status is not DONE", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const hook = mod.task.fields.completedAt.metadata.hooks?.update;
      const existing = new Date("2025-01-01");
      const result = hook({ value: existing, data: { status: "IN_PROGRESS" }, user: {} });
      expect(result).toBe(existing);
    });

    test("completedAt update hook: TODO status preserves null", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const hook = mod.task.fields.completedAt.metadata.hooks?.update;
      const result = hook({ value: null, data: { status: "TODO" }, user: {} });
      expect(result).toBeNull();
    });

    test("completedAt update hook: IN_REVIEW preserves same reference", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const hook = mod.task.fields.completedAt.metadata.hooks?.update;
      const existing = new Date("2025-06-01");
      const result = hook({ value: existing, data: { status: "IN_REVIEW" }, user: {} });
      expect(result).toBe(existing);
    });

    test("completedAt is datetime type (not date)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.fields.completedAt.type).toBe("datetime");
    });

    test("estimatedHours validation accepts small positive values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const fn = extractValidateFn(mod.task.fields.estimatedHours.metadata.validate);
      expect(fn({ value: 0.001, data: {}, user: {} })).toBe(true);
    });

    test("has composite index on projectId and status", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      const indexes = mod.task.metadata.indexes;
      expect(indexes).toBeDefined();
      const indexEntries = Object.values(indexes) as { fields: string[] }[];
      const compositeIdx = indexEntries.find(
        (idx) => idx.fields.includes("projectId") && idx.fields.includes("status"),
      );
      expect(compositeIdx, "expected composite index on projectId and status").toBeDefined();
    });

    test("assigneeId has field-level index", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.fields.assigneeId.metadata.index).toBe(true);
    });

    test("has timestamps", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expectTimestamps(mod.task);
    });
  });

  // ---------------------------------------------------------------------------
  // ActivityLog
  // ---------------------------------------------------------------------------
  describe("ActivityLog model", () => {
    test("model name is ActivityLog", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      expect(mod.activityLog.name).toBe("ActivityLog");
    });

    test("has correct field names", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      expectFieldNames(mod.activityLog, ["taskId", "actorId", "action", "detail", "createdAt"]);
    });

    test("taskId has n-1 relation to Task", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      const field = mod.activityLog.fields.taskId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Task");
    });

    test("actorId has n-1 relation to Member", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      const field = mod.activityLog.fields.actorId;
      expect(field.type).toBe("uuid");
      expect(field.rawRelation).toBeDefined();
      expect(field.rawRelation.type).toBe("n-1");
      expect(field.rawRelation.toward.type).toBe("Member");
    });

    test("action is enum with correct values", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      expectEnumValues(mod.activityLog.fields.action, [
        "CREATED",
        "UPDATED",
        "COMMENTED",
        "STATUS_CHANGED",
        "ASSIGNED",
      ]);
    });

    test("detail is nested object with 3 sub-fields", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      const detail = mod.activityLog.fields.detail;
      expect(detail.type).toBe("nested");
      const subFieldNames = Object.keys(detail.fields);
      expect(subFieldNames).toContain("previousValue");
      expect(subFieldNames).toContain("newValue");
      expect(subFieldNames).toContain("comment");
    });

    test("detail sub-fields are all string type", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      const f = mod.activityLog.fields.detail.fields;
      expect(f.previousValue.type).toBe("string");
      expect(f.newValue.type).toBe("string");
      expect(f.comment.type).toBe("string");
    });

    test("createdAt has create hook returning Date", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      const hook = mod.activityLog.fields.createdAt.metadata.hooks?.create;
      expect(hook).toBeDefined();
      expect(hook({ value: undefined, data: {}, user: {} })).toBeInstanceOf(Date);
    });

    test("does NOT have updatedAt field", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      expect(mod.activityLog.fields.updatedAt).toBeUndefined();
    });

    test("createdAt has description 'Record creation timestamp'", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      expect(mod.activityLog.fields.createdAt.metadata.description).toBe(
        "Record creation timestamp",
      );
    });

    test("has exactly 5 declared fields (plus auto-generated id)", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      const fieldNames = Object.keys(mod.activityLog.fields).filter((f) => f !== "id");
      expect(fieldNames).toHaveLength(5);
    });

    test("does NOT have permission configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/activityLog.ts"));
      expect(mod.activityLog.metadata.permissions?.record).toBeUndefined();
    });
  });

  // ===========================================================================
  // CONFIG
  // ===========================================================================
  describe("tailor.config.ts", () => {
    test("config name is project-mgmt", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.name).toBe("project-mgmt");
    });

    test("has cors array", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.cors).toBeDefined();
      expect(Array.isArray(mod.default.cors)).toBe(true);
      expect(mod.default.cors.length).toBeGreaterThan(0);
    });

    test("has db.tailordb configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.db?.tailordb).toBeDefined();
    });

    test("auth userProfile.usernameField is email", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth?.userProfile?.usernameField).toBe("email");
    });

    test("auth has 2 machine users", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const machineUsers = mod.default.auth?.machineUsers;
      expect(machineUsers).toBeDefined();
      const names = Object.keys(machineUsers);
      expect(names.length).toBe(2);
      expect(names).toContain("SYSTEM_WORKER");
      expect(names).toContain("ADMIN_SERVICE");
    });

    test("auth has oauth2 client", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const clients = mod.default.auth?.oauth2Clients;
      expect(clients).toBeDefined();
      expect(Object.keys(clients).length).toBeGreaterThanOrEqual(1);
    });

    test("has idp configuration with password policy", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.idp).toBeDefined();
      expect(Array.isArray(mod.default.idp)).toBe(true);
      const policy = mod.default.idp[0]?.userAuthPolicy;
      expect(policy).toBeDefined();
      expect(policy.passwordMinLength).toBeGreaterThanOrEqual(8);
    });

    test("has staticWebsites with dashboard", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.staticWebsites).toBeDefined();
      expect(mod.default.staticWebsites.length).toBeGreaterThanOrEqual(1);
    });

    test("generators named export exists", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.generators).toBeDefined();
      expect(Array.isArray(mod.generators)).toBe(true);
      expect(mod.generators.length).toBeGreaterThanOrEqual(2);
    });

    test("SYSTEM_WORKER machine user role is ADMIN", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const machineUsers = mod.default.auth?.machineUsers;
      expect(machineUsers.SYSTEM_WORKER.attributes.role).toBe("ADMIN");
    });

    test("ADMIN_SERVICE machine user role is OWNER", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const machineUsers = mod.default.auth?.machineUsers;
      expect(machineUsers.ADMIN_SERVICE.attributes.role).toBe("OWNER");
    });

    test("password policy requires all character types", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const policy = mod.default.idp[0]?.userAuthPolicy;
      expect(policy.passwordRequireUppercase).toBe(true);
      expect(policy.passwordRequireLowercase).toBe(true);
      expect(policy.passwordRequireNumeric).toBe(true);
      expect(policy.passwordRequireNonAlphanumeric).toBe(true);
    });

    test("oauth2 client grantTypes include authorization_code and refresh_token", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const clients = mod.default.auth?.oauth2Clients;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
      const client = Object.values(clients)[0] as any;
      expect(client.grantTypes).toContain("authorization_code");
      expect(client.grantTypes).toContain("refresh_token");
    });

    test("generators have correct distPath values", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      // generators are tuples: [name, { distPath, ... }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
      const gens = mod.generators as [string, any][];
      const kyselyGen = gens.find((g) => g[0] === "@tailor-platform/kysely-type");
      const seedGen = gens.find((g) => g[0] === "@tailor-platform/seed");
      expect(kyselyGen?.[1]?.distPath).toBe("./generated/tailordb.ts");
      expect(seedGen?.[1]?.distPath).toBe("./seed");
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-model negative tests
  // ---------------------------------------------------------------------------
  describe("Cross-model constraints", () => {
    test("Task does NOT have aggregation feature", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/task.ts"));
      expect(mod.task.metadata.settings?.aggregation).toBeUndefined();
    });

    test("Team does NOT have composite indexes", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/team.ts"));
      const indexes = mod.team.metadata.indexes;
      expect(indexes == null || Object.keys(indexes).length === 0).toBe(true);
    });

    test("Member does NOT have permission configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
      expect(mod.member.metadata.permissions?.record).toBeUndefined();
    });
  });
});
