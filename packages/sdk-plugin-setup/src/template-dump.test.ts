import * as fs from "node:fs";
import { expect, test } from "vitest";
import { renderedTemplates, writeRenderedTemplates } from "./template-fingerprint";

const { TEMPLATES_DUMP_DIR } = process.env;

test.runIf(TEMPLATES_DUMP_DIR)("writes every rendered template to TEMPLATES_DUMP_DIR", () => {
  const dir = TEMPLATES_DUMP_DIR ?? "";
  const templates = renderedTemplates();

  writeRenderedTemplates(dir, templates);

  expect(fs.readFileSync(`${dir}/renders.txt`, "utf-8").split("\n")).toHaveLength(
    templates.length + 1,
  );
});
