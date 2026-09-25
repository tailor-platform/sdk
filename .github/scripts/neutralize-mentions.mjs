#!/usr/bin/env node
// Insert a zero-width space (U+200B) right after every '@' so the text
// renders identically but GitHub never parses it as a mention. We do not
// try to match only "real" handles: ZWSP is invisible, so over-inserting
// is harmless, while missing one would notify someone.
//
// Usage:
//   node neutralize-mentions.mjs <file>   # rewrite the file in place
//   ... | node neutralize-mentions.mjs    # read stdin, write stdout

import { readFileSync, writeFileSync } from "node:fs";

const neutralize = (text) => text.replace(/@/g, "@\u200b");

const [file] = process.argv.slice(2);

if (file) {
  writeFileSync(file, neutralize(readFileSync(file, "utf8")));
} else {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(neutralize(Buffer.concat(chunks).toString("utf8")));
}
