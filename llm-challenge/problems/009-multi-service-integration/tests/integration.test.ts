import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { importPath } from "../../../shared/helpers.js";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("009-multi-service-integration", () => {
  const projectModelPath = path.join(workDir, "tailordb/project.ts");
  const taskModelPath = path.join(workDir, "tailordb/task.ts");
  const resolverPath = path.join(workDir, "resolvers/completeTask/resolver.ts");
  const executorPath = path.join(workDir, "executors/taskCompleted.ts");
  const workflowPath = path.join(workDir, "workflows/taskCleanup.ts");

  // --- File existence ---

  test("all 5 files exist", () => {
    expect(fs.existsSync(projectModelPath)).toBe(true);
    expect(fs.existsSync(taskModelPath)).toBe(true);
    expect(fs.existsSync(resolverPath)).toBe(true);
    expect(fs.existsSync(executorPath)).toBe(true);
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  // --- Project model ---

  test("project model has named export 'project'", async () => {
    const mod = await importPath(projectModelPath);
    expect(mod.project).toBeDefined();
  });

  test("project model name is 'Project'", async () => {
    const { project } = await importPath(projectModelPath);
    expect(project.name).toBe("Project");
  });

  test("project model has all required fields", async () => {
    const { project } = await importPath(projectModelPath);
    const fieldNames = Object.keys(project.fields);
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("description");
    expect(fieldNames).toContain("status");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("project name field is a required string", async () => {
    const { project } = await importPath(projectModelPath);
    const field = project.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("project description field is optional", async () => {
    const { project } = await importPath(projectModelPath);
    expect(project.fields.description.metadata.required).toBe(false);
  });

  test("project status field is an enum with correct values", async () => {
    const { project } = await importPath(projectModelPath);
    const field = project.fields.status;
    expect(field.type).toBe("enum");
    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toContain("active");
    expect(values).toContain("completed");
    expect(values).toContain("archived");
  });

  // --- Task model ---

  test("task model has named export 'task'", async () => {
    const mod = await importPath(taskModelPath);
    expect(mod.task).toBeDefined();
  });

  test("task model name is 'Task'", async () => {
    const { task } = await importPath(taskModelPath);
    expect(task.name).toBe("Task");
  });

  test("task model has all required fields", async () => {
    const { task } = await importPath(taskModelPath);
    const fieldNames = Object.keys(task.fields);
    expect(fieldNames).toContain("title");
    expect(fieldNames).toContain("description");
    expect(fieldNames).toContain("status");
    expect(fieldNames).toContain("assigneeId");
    expect(fieldNames).toContain("projectId");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("task status field is an enum with correct values", async () => {
    const { task } = await importPath(taskModelPath);
    const field = task.fields.status;
    expect(field.type).toBe("enum");
    const values = field.metadata.allowedValues.map((v: { value: string }) => v.value);
    expect(values).toContain("open");
    expect(values).toContain("in_progress");
    expect(values).toContain("completed");
    expect(values).toContain("archived");
  });

  test("task description field is optional", async () => {
    const { task } = await importPath(taskModelPath);
    expect(task.fields.description.metadata.required).toBe(false);
  });

  test("task assigneeId field is optional uuid", async () => {
    const { task } = await importPath(taskModelPath);
    const field = task.fields.assigneeId;
    expect(field.type).toBe("uuid");
    expect(field.metadata.required).toBe(false);
  });

  test("task projectId has n-1 relation to Project", async () => {
    const { task } = await importPath(taskModelPath);
    const field = task.fields.projectId;
    expect(field.type).toBe("uuid");
    expect(field.metadata.required).toBe(true);
    expect(field.rawRelation).toBeDefined();
    expect(field.rawRelation.type).toBe("n-1");
  });

  // --- Resolver ---

  test("resolver has default export", async () => {
    const mod = await importPath(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver name is 'completeTask'", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.name).toBe("completeTask");
  });

  test("resolver operation is 'mutation'", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.operation).toBe("mutation");
  });

  test("resolver input has taskId and completedBy", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.input).toBeDefined();
    expect(resolver.input.taskId).toBeDefined();
    expect(resolver.input.completedBy).toBeDefined();
  });

  test("resolver body returns correct structure", async () => {
    const { default: resolver } = await importPath(resolverPath);
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

  test("resolver output is properly structured with t.object", async () => {
    const { default: resolver } = await importPath(resolverPath);
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
  });

  // --- Executor ---

  test("executor has default export", async () => {
    const mod = await importPath(executorPath);
    expect(mod.default).toBeDefined();
  });

  test("executor name is 'task-completed-handler'", async () => {
    const { default: executor } = await importPath(executorPath);
    expect(executor.name).toBe("task-completed-handler");
  });

  test("executor trigger kind is 'recordUpdated'", async () => {
    const { default: executor } = await importPath(executorPath);
    expect(executor.trigger.kind).toBe("recordUpdated");
  });

  test("executor operation kind is 'function'", async () => {
    const { default: executor } = await importPath(executorPath);
    expect(executor.operation.kind).toBe("function");
  });

  // --- Workflow ---

  test("workflow has default export", async () => {
    const mod = await importPath(workflowPath);
    expect(mod.default).toBeDefined();
  });

  test("workflow name is 'task-cleanup'", async () => {
    const { default: workflow } = await importPath(workflowPath);
    expect(workflow.name).toBe("task-cleanup");
  });

  test("workflow has named exports for all 3 jobs", async () => {
    const mod = await importPath(workflowPath);
    expect(mod.archiveCompletedTasks).toBeDefined();
    expect(mod.cleanupNotifications).toBeDefined();
    expect(mod.taskCleanupMain).toBeDefined();
  });

  test("workflow mainJob is taskCleanupMain", async () => {
    const mod = await importPath(workflowPath);
    expect(mod.default.mainJob).toBe(mod.taskCleanupMain);
  });

  test("all job names are unique", async () => {
    const mod = await importPath(workflowPath);
    const names = [
      mod.archiveCompletedTasks.name,
      mod.cleanupNotifications.name,
      mod.taskCleanupMain.name,
    ];
    expect(new Set(names).size).toBe(3);
  });

  test("archiveCompletedTasks body returns correct structure", async () => {
    const mod = await importPath(workflowPath);
    const result = await mod.archiveCompletedTasks.body({ olderThanDays: 30 }, { env: {} });
    expect(result).toEqual({ archived: true, olderThanDays: 30 });
  });

  test("cleanupNotifications body returns correct structure", async () => {
    const mod = await importPath(workflowPath);
    const result = await mod.cleanupNotifications.body({ taskIds: ["a", "b"] }, { env: {} });
    expect(result).toEqual({ cleaned: 2 });
  });

  test("taskCleanupMain body triggers other jobs and returns results", async () => {
    const mod = await importPath(workflowPath);
    const result = mod.taskCleanupMain.body({ olderThanDays: 7 }, { env: {} });
    expect(result).toHaveProperty("archived");
    expect(result).toHaveProperty("cleaned");
  });
});
