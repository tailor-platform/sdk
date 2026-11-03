import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function isCurrentBase(expected) {
  const remote = git("ls-remote", "--exit-code", "origin", "refs/heads/main");
  const [sha, ref] = remote.split(/\s+/);
  if (!/^[0-9a-f]{40}$/.test(sha) || ref !== "refs/heads/main") {
    throw new Error("Cannot determine the current main commit.");
  }
  return sha === expected;
}

function assertCurrentBase(expected) {
  if (!isCurrentBase(expected)) {
    throw new Error("main advanced; leave release generation to its current run.");
  }
}

function commitResolvedVersions(base, branch, expectedHead) {
  if (branch !== "changeset-release/main" || git("rev-parse", "HEAD") !== expectedHead) {
    throw new Error("The checkout does not match the expected release branch head.");
  }
  git("merge-base", "--is-ancestor", base, expectedHead);
  assertCurrentBase(base);

  const paths = execFileSync("git", ["diff", "--name-only", "-z", "HEAD"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  if (paths.length === 0) return;

  const input = {
    branch: { repositoryNameWithOwner: process.env.GITHUB_REPOSITORY, branchName: branch },
    expectedHeadOid: expectedHead,
    message: { headline: "chore: resolve pending release versions" },
    fileChanges: {
      additions: paths.map((path) => ({ path, contents: readFileSync(path).toString("base64") })),
    },
  };
  const response = JSON.parse(
    execFileSync("gh", ["api", "graphql", "--input", "-"], {
      encoding: "utf8",
      input: JSON.stringify({
        query: `mutation($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) { commit { oid } }
      }`,
        variables: { input },
      }),
    }),
  );
  if (response.errors?.length || !response.data?.createCommitOnBranch?.commit?.oid) {
    throw new Error(`Release fixup was rejected: ${JSON.stringify(response.errors ?? response)}`);
  }
  console.log(`Resolved ${paths.length} pending version file(s) on ${branch}.`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "check": {
    const head = git("rev-parse", "HEAD");
    if (head !== process.env.GITHUB_SHA) {
      throw new Error("The release checkout must match GITHUB_SHA used by changesets/action.");
    }
    const current = isCurrentBase(head);
    if (!current) console.error("Skipping stale Release run: its commit is no longer main.");
    console.log(`current=${current}`);
    break;
  }
  case "assert":
    assertCurrentBase(args[0]);
    break;
  case "commit":
    commitResolvedVersions(...args);
    break;
  default:
    throw new Error("Expected check, assert <base>, or commit <base> <branch> <head>.");
}
