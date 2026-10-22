import { createHash } from "node:crypto";

const CHUNK_KEY = "seed-retry-chunk";
const TOTAL_KEY = "seed-retry-total";
const HASH_KEY = "seed-retry-hash";
const UPSERT_KEY = "seed-retry-upsert";
const EXECUTION_KEY = "seed-retry-exec";
const FAILED_AT_KEY = "seed-retry-at";

const HASH_LENGTH = 40;

/**
 * What a kept seed workflow records about the chunk that failed.
 */
export interface RetryRecord {
  /** Index of the chunk that failed, from 0 */
  chunkIndex: number;
  /** Number of chunks the seed was split into */
  total: number;
  /** Fingerprint of the chunk arguments the failed run built */
  hash: string;
  /** Whether the failed run was an upsert */
  upsert: boolean;
  /** ID of the execution that ran the failed chunk */
  executionId: string;
  /** When the chunk failed, in milliseconds since the epoch */
  failedAt: number;
}

/**
 * Fingerprint of the arguments a seed run sends, one per chunk.
 * @param chunkArgs - Arguments of every chunk, in order
 * @returns Hash that changes when any chunk's data, order or options change
 */
export function hashChunkArgs(chunkArgs: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(chunkArgs)).digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Metadata labels recording a failed chunk. The platform requires label values
 * to start with a lowercase letter, so numbers carry a one-letter prefix.
 * @param record - The failed chunk
 * @returns Labels to put on the kept workflow
 */
export function toRetryLabels(record: RetryRecord): Record<string, string> {
  return {
    [CHUNK_KEY]: `c${record.chunkIndex}`,
    [TOTAL_KEY]: `n${record.total}`,
    [HASH_KEY]: `h${record.hash}`,
    [UPSERT_KEY]: String(record.upsert),
    [EXECUTION_KEY]: `e${record.executionId}`,
    [FAILED_AT_KEY]: `t${record.failedAt}`,
  };
}

function readNumber(value: string | undefined, prefix: string): number | undefined {
  if (!value?.startsWith(prefix)) return undefined;
  const digits = value.slice(prefix.length);
  return /^\d+$/.test(digits) ? Number(digits) : undefined;
}

/**
 * Read the record of a failed chunk from a workflow's labels.
 * @param labels - Metadata labels of the workflow
 * @returns The record, or undefined when the labels do not hold a complete one
 */
export function readRetryLabels(labels: Record<string, string>): RetryRecord | undefined {
  const chunkIndex = readNumber(labels[CHUNK_KEY], "c");
  const total = readNumber(labels[TOTAL_KEY], "n");
  const failedAt = readNumber(labels[FAILED_AT_KEY], "t");
  const hash = labels[HASH_KEY]?.startsWith("h") ? labels[HASH_KEY].slice(1) : undefined;
  const upsert = labels[UPSERT_KEY];
  const executionId = labels[EXECUTION_KEY]?.startsWith("e")
    ? labels[EXECUTION_KEY].slice(1)
    : undefined;
  if (
    chunkIndex === undefined ||
    total === undefined ||
    failedAt === undefined ||
    !hash ||
    !executionId ||
    (upsert !== "true" && upsert !== "false")
  ) {
    return undefined;
  }
  return { chunkIndex, total, hash, upsert: upsert === "true", executionId, failedAt };
}
