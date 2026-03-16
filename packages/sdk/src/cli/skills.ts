#!/usr/bin/env node

import { runSkillsInstaller } from "./shared/skills-installer";

const exitCode = await runSkillsInstaller();

process.exit(exitCode);
