import * as fs from "fs";
import * as path from "path";
import { defineCommand } from "citty";
import consola from "consola";
import { withCommonArgs, commonArgs } from "../args";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken } from "../context";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { UploadFileRequestSchema } from "@tailor-proto/tailor/v1/staticwebsite_pb";

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

  for (const relativePath of files) {
    await uploadSingleFile(
      client,
      workspaceId,
      deploymentId,
      rootDir,
      relativePath,
    );
  }
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
    } else if (entry.isFile()) {
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
  const stat = await fs.promises.stat(absPath);
  if (!stat.isFile()) {
    return;
  }

  const filePath = relativePath.split(path.sep).join("/"); // posix
  const contentType = detectContentType(filePath);

  const readStream = fs.createReadStream(absPath, {
    highWaterMark: 64 * 1024,
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

  consola.debug?.(`Uploading ${filePath} (${stat.size} bytes)...`);
  await client.uploadFile(requestStream());
}

function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain";
    case ".woff2":
      return "font/woff2";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    default:
      throw new Error(
        `Unsupported file type "${ext}" for path "${filePath}". ` +
          `Please extend detectContentType() to handle this extension.`,
      );
  }
}

export const deployStaticWebsiteCommand = defineCommand({
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

    const deployResult = await deployStaticWebsite(
      client,
      workspaceId,
      name,
      dir,
    );

    consola.success(
      `Static website "${name}" deployed successfully. URL: ${deployResult}`,
    );
  }),
});
