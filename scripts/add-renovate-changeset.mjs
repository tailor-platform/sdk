#!/usr/bin/env node

/**
 * Script executed by Renovate's postUpgradeTasks
 * Automatically generates a changeset when dependencies are updated
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

/**
 * Extract package names from Git changes
 */
function getAffectedPackages() {
  try {
    // Get list of changed files
    const changedFiles = execSync("git diff --name-only HEAD", {
      encoding: "utf-8",
      cwd: rootDir,
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const affectedPackages = new Set();

    // If root package.json is changed, it may affect all packages
    if (
      changedFiles.includes("package.json") ||
      changedFiles.includes("pnpm-lock.yaml")
    ) {
      // Add main packages only
      affectedPackages.add("@tailor-platform/sdk");
      affectedPackages.add("@tailor-platform/create-sdk");
    }

    // Check for changes under packages/ directory
    for (const file of changedFiles) {
      if (file.startsWith("packages/sdk/")) {
        affectedPackages.add("@tailor-platform/sdk");
      } else if (file.startsWith("packages/create-sdk/")) {
        affectedPackages.add("@tailor-platform/create-sdk");
      } else if (file.startsWith("packages/tailor-proto/")) {
        affectedPackages.add("@tailor-platform/tailor-proto");
      }
    }

    // Use default if nothing found
    if (affectedPackages.size === 0) {
      affectedPackages.add("@tailor-platform/sdk");
    }

    return Array.from(affectedPackages);
  } catch (error) {
    console.error("Failed to detect affected packages:", error);
    // Return default on error
    return ["@tailor-platform/sdk"];
  }
}

/**
 * Get update description from branch name or commit message
 */
function getUpdateDescription() {
  try {
    // Get current branch name
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      cwd: rootDir,
    }).trim();

    // Renovate branch name pattern: renovate/package-name-1.x
    // Extract more specific description
    if (branch.startsWith("renovate/")) {
      const packageInfo = branch.replace("renovate/", "");

      // Get latest commit message (created by Renovate)
      try {
        const commitMsg = execSync("git log -1 --pretty=%B", {
          encoding: "utf-8",
          cwd: rootDir,
        }).trim();

        // Format like "Update dependency package-name to v1.2.3"
        if (commitMsg.toLowerCase().includes("update")) {
          return commitMsg;
        }
      } catch {
        // Fall back to branch name if commit message is unavailable
      }

      return `Update ${packageInfo}`;
    }

    return "Update dependencies";
  } catch (error) {
    console.error("Failed to get update description:", error);
    return "Update dependencies";
  }
}

/**
 * Generate changeset file
 */
function createChangeset() {
  const packages = getAffectedPackages();
  const description = getUpdateDescription();

  console.log("Affected packages:", packages.join(", "));
  console.log("Description:", description);

  // Changeset frontmatter section
  const frontmatter = packages.map((pkg) => `"${pkg}": patch`).join("\n");

  // Changeset content
  const changesetContent = `---
${frontmatter}
---

${description}
`;

  // Filename: renovate-{timestamp}.md
  const timestamp = Date.now();
  const filename = `renovate-${timestamp}.md`;
  const filepath = join(rootDir, ".changeset", filename);

  writeFileSync(filepath, changesetContent, "utf-8");
  console.log(`Created changeset: .changeset/${filename}`);

  return filename;
}

function main() {
  try {
    // Check if changeset already exists (excluding README.md and config.json)
    const existingChangesets = execSync(
      'find .changeset -name "*.md" ! -name "README.md" -type f',
      {
        encoding: "utf-8",
        cwd: rootDir,
      },
    ).trim();

    if (existingChangesets) {
      console.log("Changeset already exists, skipping...");
      console.log(existingChangesets);
      return;
    }

    const filename = createChangeset();
    console.log(`Successfully created changeset: ${filename}`);
  } catch (error) {
    console.error("Error creating changeset:", error);
    process.exit(1);
  }
}

main();
