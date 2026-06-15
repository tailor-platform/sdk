/**
 * Seed data chunker for splitting large seed data into manageable message sizes.
 *
 * When seed data exceeds the gRPC message size limit, this module splits the data
 * into multiple chunks at type boundaries (or record boundaries for large types).
 */

import { assertDefined } from "@/utils/assert";

/**
 * Seed data keyed by type name, with an array of records per type.
 */
export type SeedData = Record<string, Record<string, unknown>[]>;

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
  /** Byte size of the bundled seed script code */
  codeByteSize: number;
  /** Maximum gRPC message size in bytes (default: 3.5MB) */
  maxMessageSize?: number;
};

/** Default maximum message size: 3.5MB (conservative limit for gRPC) */
export const DEFAULT_MAX_MESSAGE_SIZE = 3.5 * 1024 * 1024;

/** Reserved bytes for message metadata overhead */
const METADATA_OVERHEAD = 1024;

/**
 * Split seed data into chunks that fit within the gRPC message size limit.
 *
 * Algorithm:
 * 1. Calculate the available budget for the arg field (maxMessageSize - codeByteSize - overhead)
 * 2. If all data fits in one message, return a single chunk
 * 3. Otherwise, iterate through types in dependency order:
 *    - If a type fits in the current chunk, add it
 *    - If adding a type would exceed the budget, finalize the current chunk and start a new one
 *    - If a single type exceeds the budget, split its records across multiple chunks
 *    - If a single record exceeds the budget, throw an error
 * @param options - Chunking options
 * @returns Array of seed chunks
 */
export function chunkSeedData(options: ChunkSeedDataOptions): SeedChunk[] {
  const { data, order, codeByteSize, maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE } = options;

  const argBudget = maxMessageSize - codeByteSize - METADATA_OVERHEAD;
  if (argBudget <= 0) {
    throw new Error(
      `Code size (${codeByteSize} bytes) exceeds the message size limit (${maxMessageSize} bytes). ` +
        `No space left for seed data.`,
    );
  }

  // Filter to types that have data
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

    let recordBatch: Record<string, unknown>[] = [];
    for (const record of typeRecords) {
      if (byteSize(JSON.stringify({ data: { [type]: [record] }, order: [type] })) > argBudget) {
        const singleRecordSize = byteSize(JSON.stringify(record));
        throw new Error(
          `A single record in type "${type}" (${singleRecordSize} bytes) exceeds the message size budget ` +
            `(${argBudget} bytes). Consider increasing maxMessageSize or reducing the record size.`,
        );
      }

      const testBatch = [...recordBatch, record];
      const testData = { ...currentData, [type]: testBatch };
      const testOrder = currentOrder.includes(type) ? currentOrder : [...currentOrder, type];
      const testSize = byteSize(JSON.stringify({ data: testData, order: testOrder }));

      if (testSize > argBudget && recordBatch.length > 0) {
        // Finalize current chunk with accumulated records
        currentData[type] = recordBatch;
        if (!currentOrder.includes(type)) {
          currentOrder.push(type);
        }
        chunks.push({ data: currentData, order: currentOrder, index: chunks.length });
        currentData = {};
        currentOrder = [];
        recordBatch = [record];
      } else {
        recordBatch = testBatch;
      }
    }

    // Add remaining records
    if (recordBatch.length > 0) {
      currentData[type] = recordBatch;
      if (!currentOrder.includes(type)) {
        currentOrder.push(type);
      }
    }
  }

  // Finalize the last chunk
  if (currentOrder.length > 0) {
    chunks.push({ data: currentData, order: currentOrder, index: chunks.length });
  }

  const total = chunks.length;
  return chunks.map((chunk) => ({ ...chunk, total }));
}

function byteSize(str: string): number {
  return new TextEncoder().encode(str).length;
}
