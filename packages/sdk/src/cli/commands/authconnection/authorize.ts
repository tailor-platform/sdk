import * as crypto from "node:crypto";
import * as http from "node:http";
import open from "open";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { connectionNameArgs } from "./args";

const defaultPort = 8080;
const defaultScopes = "openid,profile,email";

/**
 * Fetch the OpenID Connect discovery document from a provider URL.
 * @param providerUrl - OAuth2 provider base URL
 * @returns Discovery document with authorization_endpoint
 */
async function fetchOIDCDiscovery(
  providerUrl: string,
): Promise<{ authorization_endpoint: string }> {
  const url = providerUrl.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery from ${url}: ${response.status}`);
  }
  return response.json() as Promise<{
    authorization_endpoint: string;
  }>;
}

function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}

export const authorizeAuthConnectionCommand = defineAppCommand({
  name: "authorize",
  description: "Authorize an auth connection via OAuth2 flow.",
  args: z
    .object({
      ...workspaceArgs,
      ...connectionNameArgs,
      scopes: z
        .string()
        .optional()
        .default(defaultScopes)
        .describe("OAuth2 scopes to request (comma-separated)"),
      port: z.coerce
        .number()
        .optional()
        .default(defaultPort)
        .describe("Local callback server port"),
      "no-browser": z
        .boolean()
        .optional()
        .default(false)
        .describe("Don't open browser automatically"),
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    // Find the connection to get its provider URL and client ID
    const connections = await fetchAll(async (pageToken, maxPageSize) => {
      const { connections, nextPageToken } = await client.listAuthConnections({
        workspaceId,
        pageToken,
        pageSize: maxPageSize,
      });
      return [connections, nextPageToken];
    });

    const connection = connections.find((c) => c.name === args.name);
    if (!connection) {
      throw new Error(`Auth connection "${args.name}" not found.`);
    }

    if (connection.config.case !== "oauth2") {
      throw new Error(`Auth connection "${args.name}" is not an OAuth2 connection.`);
    }

    const oauth2Config = connection.config.value;
    const redirectUri = `http://localhost:${args.port}/callback`;
    const state = randomState();

    // Resolve authorization endpoint from discovery or explicit config
    let authorizationEndpoint: string;
    if (oauth2Config.authUrl) {
      authorizationEndpoint = oauth2Config.authUrl;
    } else {
      const discovery = await fetchOIDCDiscovery(oauth2Config.providerUrl);
      authorizationEndpoint = discovery.authorization_endpoint;
    }

    // Build authorization URL
    const authUrl = new URL(authorizationEndpoint);
    authUrl.searchParams.set("client_id", oauth2Config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", args.scopes.replace(/,/g, " "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "offline");

    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith("/callback")) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        try {
          const url = new URL(req.url, `http://localhost:${args.port}`);
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");
          const error = url.searchParams.get("error");

          if (error) {
            throw new Error(`Authorization failed: ${error}`);
          }

          if (returnedState !== state) {
            throw new Error("State mismatch — possible CSRF attack.");
          }

          if (!code) {
            throw new Error("No authorization code received.");
          }

          // Send authorization code to the platform for server-side token exchange
          await client.exchangeAuthConnectionAuthorizationCode({
            workspaceId,
            connectionName: args.name,
            authorizationCode: code,
            redirectUri,
          });

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Authorization successful</h1><p>You can close this window.</p></body></html>",
          );
          server.close();
          resolve();
        } catch (err) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`Authorization failed: ${err instanceof Error ? err.message : "Unknown error"}`);
          server.close();
          reject(err);
        }
      });

      const timeout = setTimeout(
        () => {
          server.close();
          reject(new Error("Authorization timeout exceeded (5 minutes)."));
        },
        5 * 60 * 1000,
      );

      server.on("close", () => {
        clearTimeout(timeout);
      });

      server.on("error", (err) => {
        // A listen failure never emits "close", so clear the pending timeout
        // here to avoid keeping the process alive after the command has failed.
        clearTimeout(timeout);
        // Any error here means the local callback server could not be started.
        // Guide the user to the Console-based flow as a fallback.
        const code = (err as NodeJS.ErrnoException).code;
        const portHint =
          code === "EADDRINUSE" || code === "EACCES"
            ? `Try a different port with --port, or authorize via the Console instead:`
            : `Authorize via the Console instead:`;
        logger.warn(
          `Could not start the local callback server on port ${args.port}${code ? ` (${code})` : ""}.\n` +
            `${portHint}\n` +
            `  tailor-sdk authconnection open`,
        );
        reject(err);
      });

      server.listen(args.port, async () => {
        const authorizeUrl = authUrl.toString();
        logger.info(
          args["no-browser"]
            ? `Open this URL in your browser to authorize:\n\n${authorizeUrl}\n`
            : `Opening browser for authorization:\n\n${authorizeUrl}\n`,
        );
        logger.info(
          `If this flow doesn't complete, you can authorize via the Console instead:\n` +
            `  tailor-sdk authconnection open`,
        );
        if (!args["no-browser"]) {
          try {
            await open(authorizeUrl);
          } catch {
            logger.warn(
              "Failed to open browser automatically. Please open the URL above manually.",
            );
          }
        }
      });
    });

    logger.success(`Auth connection "${args.name}" authorized successfully.`);
  },
});
