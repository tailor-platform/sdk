import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("044-multi-service-integration", () => {
  const taskModelPath = path.join(workDir, "tailordb/task.ts");
  const resolverPath = path.join(workDir, "resolvers/completeTask/resolver.ts");
  const executorPath = path.join(workDir, "executors/taskCompleted.ts");
  const workflowPath = path.join(workDir, "workflows/taskCleanup.ts");

  // --- File existence ---

  test("all 4 files exist", () => {
    expect(fs.existsSync(taskModelPath)).toBe(true);
    expect(fs.existsSync(resolverPath)).toBe(true);
    expect(fs.existsSync(executorPath)).toBe(true);
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  // --- Task model ---

  test("task model has named export 'task'", async () => {
    const mod = await import(taskModelPath);
    expect(mod.task).toBeDefined();
  });

  test("task model name is 'Task'", async () => {
    const { task } = await import(taskModelPath);
    expect(task.name).toBe("Task");
  });

  test("task model has all required fields", async () => {
    const { task } = await import(taskModelPath);
    const fieldNames = Object.keys(task.fields);
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("description");
    expect(fieldNames).toContain("status");
    expect(fieldNames).toContain("assigneeId");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("status field is an enum with correct values", async () => {
    const { task } = await import(taskModelPath);
    const field = task.fields.status;
    expect(field.type).toBe("enum");
    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toContain("open");
    expect(values).toContain("in_progress");
    expect(values).toContain("completed");
    expect(values).toContain("archived");
  });

  test("description field is optional", async () => {
    const { task } = await import(taskModelPath);
    expect(task.fields.description.metadata.required).toBe(false);
  });

  // --- Resolver ---

  test("resolver has default export", async () => {
    const mod = await import(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver name is 'completeTask'", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.name).toBe("completeTask");
  });

  test("resolver operation is 'mutation'", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.operation).toBe("mutation");
  });

  test("resolver input has taskId and completedBy", async () => {
    const { default: resolver } = await import(resolverPath);
    expect(resolver.input).toBeDefined();
    expect(resolver.input.taskId).toBeDefined();
    expect(resolver.input.completedBy).toBeDefined();
  });

  test("resolver body returns correct structure", async () => {
    const { default: resolver } = await import(resolverPath);
    const result = await resolver.body({
      input: { taskId: "task-1", completedBy: "user-1" },
      user: {},
    });
    expect(result).toEqual({
      taskId: "task-1",
      status: "completed",
      completedBy: "user-1",
    });
  });

  // --- Executor ---

  test("executor has default export", async () => {
    const mod = await import(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor name is 'task-completed-handler'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.name).toBe("task-completed-handler");
  });

  test("executor trigger kind is 'recordUpdated'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.trigger.kind).toBe("recordUpdated");
  });

  test("executor operation kind is 'function'", async () => {
    const { default: executor } = await import(executorPath);
    expect(executor.operation.kind).toBe("function");
  });

  // --- Workflow ---

  test("workflow has default export", async () => {
    const mod = await import(workflowPath);
    expect(mod.default).toBeDefined();
  });

  test("workflow name is 'task-cleanup'", async () => {
    const { default: workflow } = await import(workflowPath);
    expect(workflow.name).toBe("task-cleanup");
  });

  test("workflow has named exports for all 3 jobs", async () => {
    const mod = await import(workflowPath);
    expect(mod.archiveCompletedTasks).toBeDefined();
    expect(mod.cleanupNotifications).toBeDefined();
    expect(mod.taskCleanupMain).toBeDefined();
  });

  test("workflow mainJob is taskCleanupMain", async () => {
    const mod = await import(workflowPath);
    expect(mod.default.mainJob).toBe(mod.taskCleanupMain);
  });

  test("all job names are unique", async () => {
    const mod = await import(workflowPath);
    const names = [
      mod.archiveCompletedTasks.name,
      mod.cleanupNotifications.name,
      mod.taskCleanupMain.name,
    ];
    expect(new Set(names).size).toBe(3);
  });

  test("archiveCompletedTasks body returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = await mod.archiveCompletedTasks.body({ olderThanDays: 30 }, { env: {} });
    expect(result).toEqual({ archived: true, olderThanDays: 30 });
  });

  test("cleanupNotifications body returns correct structure", async () => {
    const mod = await import(workflowPath);
    const result = await mod.cleanupNotifications.body({ taskIds: ["a", "b"] }, { env: {} });
    expect(result).toEqual({ cleaned: 2 });
  });
});
