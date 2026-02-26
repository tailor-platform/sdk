#!/usr/bin/env node

import { runSkillsInstaller } from "./shared/skills-installer";

const exitCode = await runSkillsInstaller({
  additionalArgs: process.argv.slice(2),
});

process.exit(exitCode);
