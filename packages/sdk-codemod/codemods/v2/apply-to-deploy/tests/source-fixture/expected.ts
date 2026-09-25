import { expect, test } from "vitest";

test("keeps collected scripts", () => {
  expect(JSON.stringify({ scripts: { deploy: "tailor-sdk deploy", seed: "node seed.mjs" } })).toBe(
    '{"scripts":{"deploy":"tailor-sdk deploy","seed":"node seed.mjs"}}',
  );
});
