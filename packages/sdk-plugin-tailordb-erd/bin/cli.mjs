#!/usr/bin/env node
// Committed launcher: pnpm only links a bin whose target exists at install
// time, so the bin must not point at a build artifact (dist/) directly.
import "../dist/cli.js";
