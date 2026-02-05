import type {
  PluginGeneratedExecutor,
  PluginTriggerConfig,
  PluginOperationConfig,
  PluginRecordCreatedArgs,
  PluginRecordUpdatedArgs,
  PluginRecordDeletedArgs,
  PluginRecordTrigger,
  PluginRecordTriggerOptions,
  PluginOperation,
  PluginExecutorConfig,
  PluginDBTypeShape,
} from "./types";

/**
 * Create a trigger that fires when a TailorDB record is created.
 * For use in plugin-generated executors.
 * @param options - Trigger options
 * @returns Plugin record created trigger
 */
export function pluginRecordCreatedTrigger<T extends PluginDBTypeShape>(
  options: PluginRecordTriggerOptions<T>,
): PluginRecordTrigger<PluginRecordCreatedArgs<T>> {
  return {
    kind: "recordCreated",
    typeName: options.type.name,
  };
}

/**
 * Create a trigger that fires when a TailorDB record is updated.
 * For use in plugin-generated executors.
 * @param options - Trigger options
 * @returns Plugin record updated trigger
 */
export function pluginRecordUpdatedTrigger<T extends PluginDBTypeShape>(
  options: PluginRecordTriggerOptions<T>,
): PluginRecordTrigger<PluginRecordUpdatedArgs<T>> {
  return {
    kind: "recordUpdated",
    typeName: options.type.name,
  };
}

/**
 * Create a trigger that fires when a TailorDB record is deleted.
 * For use in plugin-generated executors.
 * @param options - Trigger options
 * @returns Plugin record deleted trigger
 */
export function pluginRecordDeletedTrigger<T extends PluginDBTypeShape>(
  options: PluginRecordTriggerOptions<T>,
): PluginRecordTrigger<PluginRecordDeletedArgs<T>> {
  return {
    kind: "recordDeleted",
    typeName: options.type.name,
  };
}

/**
 * Function type for serialization.
 * Uses a generic signature to accept any function for serialization.
 */
type SerializableFunction = (...args: never[]) => unknown;

/**
 * Serialize a function to a string expression.
 * @param fn - Function to serialize
 * @returns String representation of the function
 */
// oxlint-disable-next-line no-restricted-syntax
function serializeFunction(fn: SerializableFunction): string {
  const fnStr = fn.toString();
  // Handle arrow functions and regular functions
  return fnStr;
}

/**
 * Create a plugin-generated executor with type-safe configuration.
 * Similar to createExecutor but for use in plugins.
 * @param config - Executor configuration
 * @returns Plugin-generated executor definition
 * @example
 * ```typescript
 * createPluginExecutor({
 *   name: "user-history-on-create",
 *   description: "Records creation history for User",
 *   trigger: pluginRecordCreatedTrigger({ type: userType }),
 *   operation: {
 *     kind: "graphql",
 *     query: `mutation CreateUserHistory($input: UserHistoryCreateInput!) {
 *       createUserHistory(input: $input) { id }
 *     }`,
 *     variables: (args) => ({
 *       input: {
 *         recordId: args.newRecord.id,
 *         action: "CREATE",
 *       }
 *     }),
 *   },
 * });
 * ```
 */
export function createPluginExecutor<Args, O extends PluginOperation<Args>>(
  config: PluginExecutorConfig<Args, O>,
): PluginGeneratedExecutor {
  const { name, description, trigger, operation } = config;

  // Convert trigger (remove __args marker)
  const pluginTrigger: PluginTriggerConfig = {
    kind: trigger.kind,
    typeName: trigger.typeName,
  };

  // Convert operation
  let pluginOperation: PluginOperationConfig;
  if (operation.kind === "graphql") {
    pluginOperation = {
      kind: "graphql",
      query: operation.query,
      appName: operation.appName,
      variables: operation.variables ? serializeFunction(operation.variables) : undefined,
    };
  } else {
    pluginOperation = {
      kind: "function",
      body: serializeFunction(operation.body),
    };
  }

  return {
    name,
    description,
    trigger: pluginTrigger,
    operation: pluginOperation,
  };
}
