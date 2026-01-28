import type { ResolverConfig } from "@/configure/services/resolver/resolver";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { TailorEnv } from "@/configure/types/env";
import type { output } from "@/configure/types/helpers";
import type {
  RecordTrigger as ParserRecordTrigger,
  ResolverExecutedTrigger as ParserResolverExecutedTrigger,
} from "@/parser/service/executor/types";

interface EventArgs {
  workspaceId: string;
  appNamespace: string;
  env: TailorEnv;
}

interface RecordArgs extends EventArgs {
  typeName: string;
}

export interface RecordCreatedArgs<T extends TailorDBType> extends RecordArgs {
  newRecord: output<T>;
}

export interface RecordUpdatedArgs<T extends TailorDBType> extends RecordArgs {
  newRecord: output<T>;
  oldRecord: output<T>;
}

export interface RecordDeletedArgs<T extends TailorDBType> extends RecordArgs {
  oldRecord: output<T>;
}

export type ResolverExecutedArgs<R extends ResolverConfig> = EventArgs & {
  resolverName: string;
} & (
    | {
        success: true;
        result: output<R["output"]>;
        error?: never;
      }
    | {
        success: false;
        result?: never;
        error: string;
      }
  );

export type RecordTrigger<Args> = ParserRecordTrigger & {
  __args: Args;
};

type RecordTriggerOptions<T extends TailorDBType, Args> = {
  type: T;
  condition?: (args: Args) => boolean;
};

/**
 * Create a trigger that fires when a TailorDB record is created.
 * @template T
 * @param options - Trigger options
 * @returns Record created trigger
 */
export function recordCreatedTrigger<T extends TailorDBType>(
  options: RecordTriggerOptions<T, RecordCreatedArgs<T>>,
): RecordTrigger<RecordCreatedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "recordCreated",
    typeName: type.name,
    condition,
    __args: {} as RecordCreatedArgs<T>,
  };
}

/**
 * Create a trigger that fires when a TailorDB record is updated.
 * @template T
 * @param options - Trigger options
 * @returns Record updated trigger
 */
export function recordUpdatedTrigger<T extends TailorDBType>(
  options: RecordTriggerOptions<T, RecordUpdatedArgs<T>>,
): RecordTrigger<RecordUpdatedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "recordUpdated",
    typeName: type.name,
    condition,
    __args: {} as RecordUpdatedArgs<T>,
  };
}

/**
 * Create a trigger that fires when a TailorDB record is deleted.
 * @template T
 * @param options - Trigger options
 * @returns Record deleted trigger
 */
export function recordDeletedTrigger<T extends TailorDBType>(
  options: RecordTriggerOptions<T, RecordDeletedArgs<T>>,
): RecordTrigger<RecordDeletedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "recordDeleted",
    typeName: type.name,
    condition,
    __args: {} as RecordDeletedArgs<T>,
  };
}

export type ResolverExecutedTrigger<Args> = ParserResolverExecutedTrigger & {
  __args: Args;
};

type ResolverExecutedTriggerOptions<R extends ResolverConfig> = {
  resolver: R;
  condition?: (args: ResolverExecutedArgs<R>) => boolean;
};

/**
 * Create a trigger that fires when a resolver is executed.
 * @template R
 * @param options - Trigger options
 * @returns Resolver executed trigger
 */
export function resolverExecutedTrigger<R extends ResolverConfig>(
  options: ResolverExecutedTriggerOptions<R>,
): ResolverExecutedTrigger<ResolverExecutedArgs<R>> {
  const { resolver, condition } = options;
  return {
    kind: "resolverExecuted",
    resolverName: resolver.name,
    condition,
    __args: {} as ResolverExecutedArgs<R>,
  };
}
