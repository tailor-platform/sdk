import { initializeResult, type ContentMapperHandlers } from "./protocol";
import type { JsonRpcHandler } from "./rpc";

/**
 * Create the handlers of a content mapper that answers `initialize` at once
 * and loads the real handlers on the first request that needs them.
 * TypeScript gives up on a mapper that has not answered `initialize` within a
 * few seconds, but waits for the other requests as long as they take.
 * @param load - Loads the real handlers
 * @returns A handler for each method of the content mapper protocol
 */
export function createLazyHandlers(
  load: () => Promise<ContentMapperHandlers>,
): ContentMapperHandlers {
  let initializeParams: unknown;
  let loading: Promise<ContentMapperHandlers> | undefined;
  const loaded = () =>
    (loading ??= load().then(async (handlers) => {
      await handlers.initialize(initializeParams);
      return handlers;
    }));
  const delegate =
    (method: keyof ContentMapperHandlers): JsonRpcHandler =>
    async (params) =>
      (await loaded())[method](params);

  return {
    initialize(params) {
      initializeParams = params;
      return initializeResult(params);
    },
    openProject: delegate("openProject"),
    transform: delegate("transform"),
    closeProject: (params) => (loading ? delegate("closeProject")(params) : {}),
  };
}
