import { arg } from "@politty/zod";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { z } from "zod";
import { durationArg, recoveryContextArgs } from "#/cli/shared/args";
import { formatCommandHint } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";

export const cloneWorkspaceArgs = {
  from: arg(z.string(), {
    description: "Workspace ID to copy data from",
    completion: { type: "none" },
  }),
  to: arg(z.string(), {
    description: "Workspace ID to copy data to",
    completion: { type: "none" },
  }),
};

export const cloneTimeoutArg = arg(durationArg.default("30m"), {
  description:
    "How long to wait for the clone to finish, e.g. 30s or 10m. The clone keeps running on the platform when the wait ends.",
  completion: { type: "none" },
});

export interface CloneOperationRef {
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  operationId: string;
  profile?: string | undefined;
}

export function resumeCommandArgs(ref: CloneOperationRef): string[] {
  return [
    "data",
    "operation",
    "get",
    "--from",
    ref.sourceWorkspaceId,
    "--to",
    ref.targetWorkspaceId,
    "--operation-id",
    ref.operationId,
    "--wait",
    ...recoveryContextArgs({ profile: ref.profile }),
  ];
}

export function resumeHint(ref: CloneOperationRef): string {
  return formatCommandHint({ command: "tailor", args: resumeCommandArgs(ref) });
}

export async function hintOnInterrupt<T>(
  ref: CloneOperationRef,
  run: () => Promise<T>,
): Promise<T> {
  const onInterrupt = () => {
    logger.info(
      `Stopped waiting. The clone keeps running on the platform. To wait for it: ${resumeHint(ref)}`,
    );
  };
  process.once("SIGINT", onInterrupt);
  try {
    return await run();
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

const STATUS_NAMES: Partial<Record<CloneOperationStatus, string>> = {
  [CloneOperationStatus.PENDING]: "pending",
  [CloneOperationStatus.PROCESSING]: "processing",
  [CloneOperationStatus.COMPLETED]: "completed",
  [CloneOperationStatus.FAILED]: "failed",
};

export function statusName(status: CloneOperationStatus): string {
  return STATUS_NAMES[status] ?? "unknown";
}

export function reportStatus(status: CloneOperationStatus): void {
  logger.info(`status: ${statusName(status)}`, { mode: "stream" });
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
