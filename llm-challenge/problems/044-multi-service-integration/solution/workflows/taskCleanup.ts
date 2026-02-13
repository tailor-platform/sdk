import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const archiveCompletedTasks = createWorkflowJob({
  name: "archive-completed-tasks",
  body: (input: { olderThanDays: number }) => {
    return { archived: true, olderThanDays: input.olderThanDays };
  },
});

export const cleanupNotifications = createWorkflowJob({
  name: "cleanup-notifications",
  body: (input: { taskIds: string[] }) => {
    return { cleaned: input.taskIds.length };
  },
});

export const taskCleanupMain = createWorkflowJob({
  name: "task-cleanup-main",
  body: (input: { olderThanDays: number }) => {
    const archived = archiveCompletedTasks.trigger({ olderThanDays: input.olderThanDays });
    const cleaned = cleanupNotifications.trigger({ taskIds: [] });
    return { archived, cleaned };
  },
});

export default createWorkflow({
  name: "task-cleanup",
  mainJob: taskCleanupMain,
});
