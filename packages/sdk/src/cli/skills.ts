#!/usr/bin/env node

import { resolve } from "pathe";
import { runSkillsInstaller } from "./shared/skills-installer";

// Resolves to {sdk_package_root}/skills. This file ships as dist/cli/skills.mjs,
// so `../..` steps out of dist/cli/ to the package root where /skills/ is packaged.
const bundledSkillsDir = resolve(import.meta.dirname, "..", "..", "skills");

const exitCode = await runSkillsInstaller({
  additionalArgs: process.argv.slice(2),
  source: bundledSkillsDir,
});

process.exit(exitCode);
