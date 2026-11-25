import { describe, expect, test, vi } from "vitest";
import { exitAfterOutput } from "./exit-after-output";

function fakeStream(queued: number) {
  const write = vi.fn((_chunk: string, callback: () => void) => {
    callback();
    return true;
  });
  return { stream: { writableLength: queued, write }, write };
}

describe("exitAfterOutput", () => {
  test("exits with the given code once a stream with queued output has flushed", async () => {
    const queued = fakeStream(10);
    const exit = vi.fn();

    await exitAfterOutput(1, { streams: [queued.stream], exit });

    expect(queued.write).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(queued.write.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("does not wait on a stream with nothing queued", async () => {
    const idle = fakeStream(0);
    const exit = vi.fn();

    await exitAfterOutput(2, { streams: [idle.stream], exit });

    expect(idle.write).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(2);
  });
});
