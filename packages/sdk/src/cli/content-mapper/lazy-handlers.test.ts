import { describe, expect, test, vi } from "vitest";
import { createLazyHandlers } from "./lazy-handlers";
import type { ContentMapperHandlers } from "./protocol";

function loadedHandlers(): ContentMapperHandlers {
  return {
    initialize: vi.fn(),
    openProject: vi.fn(() => ({ configIdentity: "id" })),
    transform: vi.fn(() => ({ text: "" })),
    closeProject: vi.fn(() => ({})),
  };
}

describe("createLazyHandlers", () => {
  test("answers initialize before the handlers are loaded", async () => {
    const load = vi.fn(() => new Promise<ContentMapperHandlers>(() => {}));
    const handlers = createLazyHandlers(load);

    expect(await handlers.initialize({ positionEncodings: ["utf-8"], protocolVersion: 1 })).toEqual(
      { protocolVersion: 1, positionEncoding: "utf-8", diagnosticSource: "tailor" },
    );
    expect(load).not.toHaveBeenCalled();
  });

  test("loads the handlers on the first project request and gives them the negotiated initialize", async () => {
    const loaded = loadedHandlers();
    const handlers = createLazyHandlers(() => Promise.resolve(loaded));
    await handlers.initialize({ positionEncodings: ["utf-8"] });

    const opened = await handlers.openProject({ configFileName: "/p/tsconfig.json" });

    expect(loaded.initialize).toHaveBeenCalledWith({ positionEncodings: ["utf-8"] });
    expect(loaded.openProject).toHaveBeenCalledWith({ configFileName: "/p/tsconfig.json" });
    expect(opened).toEqual({ configIdentity: "id" });
  });

  test("loads the handlers once however many requests arrive", async () => {
    const load = vi.fn(() => Promise.resolve(loadedHandlers()));
    const handlers = createLazyHandlers(load);

    await Promise.all([handlers.openProject({}), handlers.transform({}), handlers.transform({})]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  test("closes a project that was never opened without loading the handlers", async () => {
    const load = vi.fn(() => Promise.resolve(loadedHandlers()));
    const handlers = createLazyHandlers(load);

    expect(await handlers.closeProject({ projectHandle: "p1" })).toEqual({});
    expect(load).not.toHaveBeenCalled();
  });
});
