import * as fs from "fs";
import * as path from "path";
import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import consola from "consola";
import { lookup as mimeLookup } from "mime-types";
import pLimit from "p-limit";
import { withCommonArgs, commonArgs } from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken } from "../context";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { UploadFileRequestSchema } from "@tailor-proto/tailor/v1/staticwebsite_pb";

const CHUNK_SIZE = 64 * 1024; // 64KB
const IGNORED_FILES = new Set([".DS_Store", "thumbs.db", "desktop.ini"]);
function shouldIgnoreFile(filePath: string) {
  const fileName = path.basename(filePath).toLowerCase();
  return IGNORED_FILES.has(fileName);
}

async function withTimeout(p: Promise<any>, ms: number, message: string) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
}

async function deployStaticWebsite(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  distDir: string,
): Promise<string> {
  consola.info("Creating deployment...");
  const { deploymentId } = await client.createDeployment({
    workspaceId,
    name,
  });

  if (!deploymentId) {
    throw new Error("createDeployment returned empty deploymentId");
  }

  consola.info("Uploading files...");
  await uploadDirectory(client, workspaceId, deploymentId, distDir);

  consola.info("Publishing deployment...");
  const { url } = await client.publishDeployment({
    workspaceId,
    deploymentId,
  });

  if (!url) {
    throw new Error("publishDeployment returned empty url");
  }

  return url;
}

async function uploadDirectory(
  client: OperatorClient,
  workspaceId: string,
  deploymentId: string,
  rootDir: string,
): Promise<void> {
  const files = await collectFiles(rootDir);
  if (files.length === 0) {
    consola.warn(`No files found under ${rootDir}`);
    return;
  }

  const concurrency = 5;
  const limit = pLimit(concurrency);

  await Promise.all(
    files.map((relativePath) =>
      limit(() =>
        uploadSingleFile(
          client,
          workspaceId,
          deploymentId,
          rootDir,
          relativePath,
        ),
      ),
    ),
  );
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
): Promise<void> {
  const absPath = path.join(rootDir, relativePath);

  const filePath = relativePath.split(path.sep).join("/");

  const mime = mimeLookup(filePath);

  if (!mime) {
    consola.warn(
      `Skipping "${filePath}": unsupported content type (no mapping found).`,
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
        consola.warn(
          `Skipping "${filePath}": server rejected this file as invalid (possibly unsupported content type or size). Details: ${error.message}`,
        );
        return;
      }
      consola.error(`Failed to upload "${filePath}": ${error}`);
    }
  }

  consola.debug(`Uploading ${filePath}...`);
  await withTimeout(
    uploadWithLogging(),
    2 * 60_000,
    `Upload timed out for "${filePath}"`,
  );
}

export const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy a static website",
  },
  args: {
    ...commonArgs,
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
  },
  run: withCommonArgs(async (args) => {
    console.log(
      `Deploying static website '${args.name}' from directory '${args.dir}' to workspace '${args["workspace-id"] || "default workspace"}'...`,
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

    consola.info(`Deploying static website "${name}" from directory: ${dir}`);

    const deployResult = await withTimeout(
      deployStaticWebsite(client, workspaceId, name, dir),
      10 * 60_000,
      "Deployment timed out after 10 minutes.",
    );

    consola.success(
      `Static website "${name}" deployed successfully. URL: ${deployResult}`,
    );
  }),
});
