import * as fs from "fs";
import * as path from "path";
import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import consola, { createConsola } from "consola";
import { lookup as mimeLookup } from "mime-types";
import pLimit from "p-limit";
import { withCommonArgs, commonArgs, jsonArgs } from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { createProgress, withTimeout } from "../progress";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { UploadFileRequestSchema } from "@tailor-proto/tailor/v1/staticwebsite_pb";

const noTimeLogger = createConsola({
  formatOptions: {
    date: false,
  },
});

const CHUNK_SIZE = 64 * 1024; // 64KB
const IGNORED_FILES = new Set([".DS_Store", "thumbs.db", "desktop.ini"]);
function shouldIgnoreFile(filePath: string) {
  const fileName = path.basename(filePath).toLowerCase();
  return IGNORED_FILES.has(fileName);
}

type DeployResult = {
  url: string;
  skippedFiles: string[];
};

async function deployStaticWebsite(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  distDir: string,
  showProgress: boolean = true,
): Promise<DeployResult> {
  const { deploymentId } = await client.createDeployment({
    workspaceId,
    name,
  });

  if (!deploymentId) {
    throw new Error("createDeployment returned empty deploymentId");
  }

  const skippedFiles = await uploadDirectory(
    client,
    workspaceId,
    deploymentId,
    distDir,
    showProgress,
  );

  const { url } = await client.publishDeployment({
    workspaceId,
    deploymentId,
  });

  if (!url) {
    throw new Error("publishDeployment returned empty url");
  }

  return { url, skippedFiles };
}

async function uploadDirectory(
  client: OperatorClient,
  workspaceId: string,
  deploymentId: string,
  rootDir: string,
  showProgress: boolean,
): Promise<string[]> {
  const files = await collectFiles(rootDir);
  if (files.length === 0) {
    consola.warn(`No files found under ${rootDir}`);
    return [];
  }

  const concurrency = 5;
  const limit = pLimit(concurrency);

  const total = files.length;
  const progress = showProgress
    ? createProgress("Uploading files", total)
    : undefined;
  const skippedFiles: string[] = [];

  await Promise.all(
    files.map((relativePath) =>
      limit(async () => {
        await uploadSingleFile(
          client,
          workspaceId,
          deploymentId,
          rootDir,
          relativePath,
          skippedFiles,
        );
        if (progress) {
          progress.update();
        }
      }),
    ),
  );

  if (progress) {
    progress.finish();
  }

  return skippedFiles;
}

async function collectFiles(
  rootDir: string,
  currentDir = "",
): Promise<string[]> {
  const dirPath = path.join(rootDir, currentDir);

  const entries = await fs.promises.readdir(dirPath, {
    withFileTypes: true,
  });
  const files: string[] = [];

  for (const entry of entries) {
    const rel = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectFiles(rootDir, rel);
      files.push(...sub);
    } else if (
      entry.isFile() &&
      !entry.isSymbolicLink() &&
      !shouldIgnoreFile(rel)
    ) {
      files.push(rel);
    }
  }

  return files;
}

async function uploadSingleFile(
  client: OperatorClient,
  workspaceId: string,
  deploymentId: string,
  rootDir: string,
  relativePath: string,
  skippedFiles: string[],
): Promise<void> {
  const absPath = path.join(rootDir, relativePath);

  const filePath = relativePath.split(path.sep).join("/");

  const mime = mimeLookup(filePath);

  if (!mime) {
    skippedFiles.push(
      `${filePath} (unsupported content type; no MIME mapping found)`,
    );
    return;
  }

  const contentType = mime;

  const readStream = fs.createReadStream(absPath, {
    highWaterMark: CHUNK_SIZE,
  });

  async function* requestStream(): AsyncIterable<
    MessageInitShape<typeof UploadFileRequestSchema>
  > {
    yield {
      payload: {
        case: "initialMetadata",
        value: {
          workspaceId,
          deploymentId,
          filePath,
          contentType,
        },
      },
    };
    for await (const chunk of readStream) {
      yield {
        payload: {
          case: "chunkData",
          value: chunk as Buffer,
        },
      };
    }
  }

  async function uploadWithLogging() {
    try {
      await client.uploadFile(requestStream());
    } catch (error) {
      if (
        error instanceof ConnectError &&
        error.code === Code.InvalidArgument
      ) {
        skippedFiles.push(
          `${filePath} (server rejected file as invalid: ${error.message})`,
        );
        return;
      }
      // For non-validation errors, fail the deployment as before.
      throw error;
    }
  }

  await withTimeout(
    uploadWithLogging(),
    // 2 minutes per file
    2 * 60_000,
    `Upload timed out for "${filePath}"`,
  );
}

function logSkippedFiles(skippedFiles: string[]) {
  if (skippedFiles.length === 0) {
    return;
  }
  noTimeLogger.log(
    "⚠️WARNING: Deployment completed, but some files failed to upload. These files may have unsupported content types or other validation issues. Please review the list below:",
  );
  for (const file of skippedFiles) {
    noTimeLogger.log(`  - ${file}`);
  }
}

export const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy a static website",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
    },
    name: {
      type: "string",
      description: "Static website name",
      alias: "n",
      required: true,
    },
    dir: {
      type: "string",
      description: "Path to the static website files",
      alias: "d",
      required: true,
    },
    do: {
      alias: "d",
    },
  },
  run: withCommonArgs(async (args) => {
    consola.info(
      `Deploying static website "${args.name}" from directory: ${args.dir}`,
    );
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);

    const name = args.name;
    const dir = path.resolve(process.cwd(), args.dir);
    const workspaceId = args["workspace-id"];

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`Directory not found or not a directory: ${dir}`);
    }

    const { url, skippedFiles } = await withTimeout(
      deployStaticWebsite(client, workspaceId, name, dir, !args.json),
      // 10 minutes
      10 * 60_000,
      "Deployment timed out after 10 minutes.",
    );

    if (args.json) {
      console.log(
        JSON.stringify({
          name,
          workspaceId,
          url,
          skippedFiles,
        }),
      );
    } else {
      consola.success(
        `Static website "${name}" deployed successfully. URL: ${url}`,
      );
      logSkippedFiles(skippedFiles);
    }
  }),
});
