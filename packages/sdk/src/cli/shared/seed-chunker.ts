/**
 * Seed data chunker for splitting large seed data into manageable message sizes.
 *
 * When seed data exceeds the size one script execution can take as its argument,
 * this module splits the data into multiple chunks at type boundaries (or record
 * boundaries for large types).
 */

import { assertDefined } from "#/utils/assert";
import { CLIError } from "./errors";
import type { JsonObject } from "type-fest";

/**
 * Seed data keyed by table name, with an array of records per table.
 */
export type SeedData = Record<string, JsonObject[]>;

/**
 * A single chunk of seed data with metadata for ordered execution.
 */
export type SeedChunk = {
  data: SeedData;
  order: string[];
  index: number;
  total: number;
};

/**
 * Options for chunking seed data.
 */
export type ChunkSeedDataOptions = {
  /** Seed data keyed by type name */
  data: SeedData;
  /** Ordered list of type names (dependency order) */
  order: string[];
  /** Byte size of script code sent in the same message as the data (0 when it is sent apart) */
  codeByteSize: number;
  /** Maximum message size in bytes (default: 3.5MB) */
  maxMessageSize?: number;
};

/** Default maximum message size: 3.5MB (conservative margin under the 4MB limit of a workflow start argument) */
export const DEFAULT_MAX_MESSAGE_SIZE = 3.5 * 1024 * 1024;

/** Reserved bytes for message metadata overhead */
const METADATA_OVERHEAD = 1024;

/**
 * Split seed data into chunks that fit within the message size limit.
 *
 * Algorithm:
 * 1. Calculate the available budget for the arg field (maxMessageSize - codeByteSize - overhead)
 * 2. If all data fits in one message, return a single chunk
 * 3. Otherwise, iterate through tables in dependency order:
 *    - If a table fits in the current chunk, add it
 *    - If adding a table would exceed the budget, finalize the current chunk and start a new one
 *    - If a single table exceeds the budget, split its records across multiple chunks
 *    - If a single record exceeds the budget, throw an error
 * @param options - Chunking options
 * @returns Array of seed chunks
 */
export function chunkSeedData(options: ChunkSeedDataOptions): SeedChunk[] {
  const { data, order, codeByteSize, maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE } = options;

  const argBudget = maxMessageSize - codeByteSize - METADATA_OVERHEAD;
  if (argBudget <= 0) {
    throw CLIError({
      code: "SEED_MESSAGE_SIZE_EXCEEDED",
      message: `Code size (${codeByteSize} bytes) exceeds the message size limit (${maxMessageSize} bytes).`,
      details: "No space left for seed data.",
      context: { codeByteSize, maxMessageSize },
    });
  }

  // Filter to tables that have data
  const typesWithData = order.filter((type) => (data[type]?.length ?? 0) > 0);

  if (typesWithData.length === 0) {
    return [];
  }

  // Check if all data fits in a single message
  const fullArg = JSON.stringify({ data, order });
  if (byteSize(fullArg) <= argBudget) {
    return [{ data, order, index: 0, total: 1 }];
  }

  // Split into multiple chunks
  const chunks: Omit<SeedChunk, "total">[] = [];
  let currentData: SeedData = {};
  let currentOrder: string[] = [];

  for (const type of typesWithData) {
    const typeRecords = assertDefined(data[type], `seed data missing for type: ${type}`);

    // Check if the type fits in the current chunk
    if (currentOrder.length > 0) {
      const testData = { ...currentData, [type]: typeRecords };
      const testOrder = [...currentOrder, type];
      if (byteSize(JSON.stringify({ data: testData, order: testOrder })) > argBudget) {
        // Finalize the current chunk
        chunks.push({ data: currentData, order: currentOrder, index: chunks.length });
        currentData = {};
        currentOrder = [];
      }
    }

    // Check if the entire type fits in an empty chunk
    if (byteSize(JSON.stringify({ data: { [type]: typeRecords }, order: [type] })) <= argBudget) {
      currentData[type] = typeRecords;
      currentOrder.push(type);
      continue;
    }

    // Type is too large — split by records
    if (currentOrder.length > 0) {
      chunks.push({ data: currentData, order: currentOrder, index: chunks.length });
      currentData = {};
      currentOrder = [];
    }

    const emptyBatchByteSize = byteSize(JSON.stringify({ data: { [type]: [] }, order: [type] }));
    let recordBatch: JsonObject[] = [];
    let batchByteSize = emptyBatchByteSize;
    for (const record of typeRecords) {
      const recordByteSize = byteSize(JSON.stringify(record));
      if (emptyBatchByteSize + recordByteSize > argBudget) {
        throw CLIError({
          code: "SEED_MESSAGE_SIZE_EXCEEDED",
          message: `A single record in table "${type}" (${recordByteSize} bytes) exceeds the message size budget (${argBudget} bytes).`,
          suggestion: "Increase maxMessageSize or reduce the record size.",
          context: { type, recordByteSize, argBudget },
        });
      }

      const separatorByteSize = recordBatch.length > 0 ? 1 : 0;
      if (batchByteSize + separatorByteSize + recordByteSize > argBudget) {
        chunks.push({ data: { [type]: recordBatch }, order: [type], index: chunks.length });
        recordBatch = [record];
        batchByteSize = emptyBatchByteSize + recordByteSize;
      } else {
        recordBatch.push(record);
        batchByteSize += separatorByteSize + recordByteSize;
      }
    }

    // Add remaining records
    if (recordBatch.length > 0) {
      currentData[type] = recordBatch;
      currentOrder.push(type);
    }
  }

  // Finalize the last chunk
  if (currentOrder.length > 0) {
    chunks.push({ data: currentData, order: currentOrder, index: chunks.length });
  }

  const total = chunks.length;
  return chunks.map((chunk) => ({ ...chunk, total }));
}

const ESCAPED_BY_PLATFORM = /[<>&\u2028\u2029]/g;

// The platform decodes the start argument and encodes it again before it checks the size, and the
// encoding writes these characters as \uXXXX (6 bytes each) instead of as themselves.
function platformEncoded(json: string): string {
  return json.replace(
    ESCAPED_BY_PLATFORM,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function byteSize(json: string): number {
  return new TextEncoder().encode(platformEncoded(json)).length;
}
