import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSaver } from "./saver";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(write = vi.fn(async (_field: "code" | "arg", _text: string) => {})) {
  const errors: (string | undefined)[] = [];
  const saver = createSaver({ write, onError: (message) => errors.push(message), delayMs: 400 });
  saver.setServer("code", "old");
  saver.setServer("arg", "{}");
  return { saver, write, errors };
}

describe("edit", () => {
  test("writes an edit once the delay has passed, and not before", async () => {
    const { saver, write } = setup();

    saver.edit("code", "new");
    await vi.advanceTimersByTimeAsync(399);
    const before = write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);

    expect([before, write.mock.calls]).toEqual([0, [["code", "new"]]]);
  });

  test("writes only the latest of several edits", async () => {
    const { saver, write } = setup();

    saver.edit("code", "a");
    await vi.advanceTimersByTimeAsync(200);
    saver.edit("code", "ab");
    await vi.advanceTimersByTimeAsync(400);

    expect(write.mock.calls).toEqual([["code", "ab"]]);
  });

  test("writes nothing for text that is what the server has", async () => {
    const { saver, write } = setup();

    saver.edit("code", "old");
    await vi.advanceTimersByTimeAsync(1000);

    expect(write).not.toHaveBeenCalled();
  });

  test("drops an edit that is typed back to what the server has", async () => {
    const { saver, write } = setup();

    saver.edit("code", "new");
    saver.edit("code", "old");
    await vi.advanceTimersByTimeAsync(1000);

    expect(write).not.toHaveBeenCalled();
  });

  test("does not write an argument that is not valid, and forgets the one that was waiting", async () => {
    const { saver, write } = setup();

    saver.edit("arg", "{a: 1}");
    saver.edit("arg", "{a: ", false);
    await vi.advanceTimersByTimeAsync(1000);
    const flushed = await saver.flush();

    expect([write.mock.calls.length, flushed]).toEqual([0, undefined]);
  });
});

describe("setServer", () => {
  test("drops the edit that was waiting when the file changes from outside", async () => {
    const { saver, write } = setup();
    saver.edit("code", "mine");

    saver.setServer("code", "theirs");
    await vi.advanceTimersByTimeAsync(1000);

    expect(write).not.toHaveBeenCalled();
  });
});

describe("a write that fails", () => {
  test("is reported, and the edit stays waiting instead of counting as saved", async () => {
    const write = vi.fn(async () => {
      throw new Error("Request failed (500)");
    });
    const { saver, errors } = setup(write);

    saver.edit("code", "new");
    await vi.advanceTimersByTimeAsync(400);
    const again = await saver.flush();

    expect([errors[0], again, write.mock.calls.length]).toEqual([
      "Request failed (500)",
      "Request failed (500)",
      2,
    ]);
  });

  test("is written again by the next flush, and the report goes away once it succeeds", async () => {
    const write = vi
      .fn<(field: "code" | "arg", text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const { saver, errors } = setup(write);
    saver.edit("code", "new");
    await vi.advanceTimersByTimeAsync(400);

    const flushed = await saver.flush();

    expect([flushed, errors, write.mock.calls]).toEqual([
      undefined,
      ["disk full", undefined],
      [
        ["code", "new"],
        ["code", "new"],
      ],
    ]);
  });
});

describe("flush", () => {
  test("writes what is waiting now instead of after the delay, and waits for it", async () => {
    const { saver, write } = setup();
    saver.edit("code", "new");
    saver.edit("arg", "{a: 1}");

    const flushed = await saver.flush();

    expect([flushed, write.mock.calls]).toEqual([
      undefined,
      [
        ["code", "new"],
        ["arg", "{a: 1}"],
      ],
    ]);
  });

  test("does not write the same edit again when the delay runs out afterwards", async () => {
    const { saver, write } = setup();
    saver.edit("code", "new");
    await saver.flush();

    await vi.advanceTimersByTimeAsync(1000);

    expect(write).toHaveBeenCalledTimes(1);
  });

  test("has nothing to do when nothing is waiting", async () => {
    const { saver, write } = setup();

    const flushed = await saver.flush();

    expect([flushed, write.mock.calls.length]).toEqual([undefined, 0]);
  });

  test("waits for a write that is already on its way", async () => {
    let finish: () => void = () => {};
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { saver } = setup(write);
    saver.edit("code", "new");
    await vi.advanceTimersByTimeAsync(400);
    let done = false;

    const flushing = saver.flush().then(() => {
      done = true;
    });
    await Promise.resolve();
    const beforeFinish = done;
    finish();
    await flushing;

    expect([beforeFinish, done]).toEqual([false, true]);
  });
});
