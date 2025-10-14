#!/usr/bin/env node

/**
 * License Checker for CI
 *
 * This script checks that all dependencies use allowed licenses based on
 * the Google licenseclassifier categories.
 * https://github.com/google/licenseclassifier
 *
 * Usage:
 *   node scripts/check-license.js
 *
 * Exit codes:
 *   0 - All licenses are allowed
 *   1 - Found disallowed licenses or error occurred
 *
 * Multi-license handling:
 *   Expressions like "(MIT OR Apache-2.0)" or "(Apache-2.0 AND BSD-3-Clause)"
 *   are supported. For simplicity, ALL mentioned licenses must be allowed
 *   regardless of whether they're combined with AND or OR.
 */

import { execSync } from "node:child_process";

const allowedLicenses = new Set([
  // Reciprocal
  // https://github.com/google/licenseclassifier/blob/e6a9bb99b5a6f71d5a34336b8245e305f5430f99/license_type.go#L225
  "APSL-1.0",
  "APSL-1.1",
  "APSL-1.2",
  "APSL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
  "CPL-1.0",
  "EPL-1.0",
  "EPL-2.0",
  "FreeImage",
  "IPL-1.0",
  "MPL-1.0",
  "MPL-1.1",
  "MPL-2.0",
  "Ruby",
  // Notice
  // https://github.com/google/licenseclassifier/blob/e6a9bb99b5a6f71d5a34336b8245e305f5430f99/license_type.go#L249
  "AFL-1.1",
  "AFL-1.2",
  "AFL-2.0",
  "AFL-2.1",
  "AFL-3.0",
  "Apache-1.0",
  "Apache-1.1",
  "Apache-2.0",
  "Artistic-1.0-cl8",
  "Artistic-1.0-Perl",
  "Artistic-1.0",
  "Artistic-2.0",
  "BSL-1.0",
  "BSD-2-Clause-FreeBSD",
  "BSD-2-Clause-NetBSD",
  "BSD-2-Clause",
  "BSD-3-Clause-Attribution",
  "BSD-3-Clause-Clear",
  "BSD-3-Clause-LBNL",
  "BSD-3-Clause",
  "BSD-4-Clause",
  "BSD-4-Clause-UC",
  "BSD-Protection",
  "CC-BY-1.0",
  "CC-BY-2.0",
  "CC-BY-2.5",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "FTL",
  "ISC",
  "ImageMagick",
  "Libpng",
  "Lil-1.0",
  "Linux-OpenIB",
  "LPL-1.02",
  "LPL-1.0",
  "MS-PL",
  "MIT",
  "NCSA",
  "OpenSSL",
  "PHP-3.01",
  "PHP-3.0",
  "PIL",
  "Python-2.0",
  "Python-2.0-complete",
  "PostgreSQL",
  "SGI-B-1.0",
  "SGI-B-1.1",
  "SGI-B-2.0",
  "Unicode-DFS-2015",
  "Unicode-DFS-2016",
  "Unicode-TOU",
  "UPL-1.0",
  "W3C-19980720",
  "W3C-20150513",
  "W3C",
  "X11",
  "Xnet",
  "Zend-2.0",
  "zlib-acknowledgement",
  "Zlib",
  "ZPL-1.1",
  "ZPL-2.0",
  "ZPL-2.1",
  // Unencumbered
  // https://github.com/google/licenseclassifier/blob/e6a9bb99b5a6f71d5a34336b8245e305f5430f99/license_type.go#L324
  "CC0-1.0",
  "Unlicense",
  "0BSD",
  // Unknown (allowed for now, but should be investigated)
  "Unknown",
]);

function isLicenseAllowed(licenseString) {
  if (/\s+(?:OR|AND)\s+/i.test(licenseString)) {
    const licenses = licenseString
      .replace(/[()]/g, "")
      .trim()
      .split(/\s+(?:OR|AND)\s+/i)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return licenses.every((l) => allowedLicenses.has(l));
  }
  return allowedLicenses.has(licenseString);
}

function main() {
  console.log("Checking licenses...\n");
  execSync("pnpm licenses list", { stdio: "inherit" });

  const output = execSync("pnpm licenses list --json");
  const licensesJson = JSON.parse(output);

  const violations = [];
  for (const [license, packages] of Object.entries(licensesJson)) {
    if (!isLicenseAllowed(license)) {
      for (const pkg of packages) {
        violations.push({
          package: pkg.name,
          license,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log("All licenses are allowed.");
    process.exit(0);
  } else {
    console.error("Found dependencies with disallowed licenses:\n");
    for (const violation of violations) {
      console.error(`  - ${violation.package}`);
      console.error(`    License: ${violation.license}\n`);
    }
    process.exit(1);
  }
}

main();
