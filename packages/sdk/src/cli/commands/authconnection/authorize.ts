import * as crypto from "node:crypto";
import * as http from "node:http";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import open from "open";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { connectionNameArgs } from "./args";

const defaultPort = 8085;
const defaultScopes = "openid,profile,email";

/**
 * Fetch the OpenID Connect discovery document from a provider URL.
 * @param providerUrl - OAuth2 provider base URL
 * @returns Discovery document with authorization_endpoint and token_endpoint
 */
async function fetchOIDCDiscovery(
  providerUrl: string,
): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const url = providerUrl.replace(/\/$/, "") + "/.well-known/openid-configuration";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery from ${url}: ${response.status}`);
  }
  return response.json() as Promise<{
    authorization_endpoint: string;
    token_endpoint: string;
  }>;
}

function randomState() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

type ExchangeCodeParams = {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
};

/**
 * Exchange authorization code for tokens at the token endpoint.
 * Uses PKCE without client_secret (public client pattern).
 * @param params - Token exchange parameters
 * @returns Token response from the provider
 */
async function exchangeCodeForTokens(params: ExchangeCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<TokenResponse>;
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
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
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
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Resolve endpoints from discovery or explicit config
    let authorizationEndpoint: string;
    let tokenEndpoint: string;
    if (oauth2Config.authUrl && oauth2Config.tokenUrl) {
      authorizationEndpoint = oauth2Config.authUrl;
      tokenEndpoint = oauth2Config.tokenUrl;
    } else {
      const discovery = await fetchOIDCDiscovery(oauth2Config.providerUrl);
      authorizationEndpoint = oauth2Config.authUrl || discovery.authorization_endpoint;
      tokenEndpoint = oauth2Config.tokenUrl || discovery.token_endpoint;
    }

    // Build authorization URL with PKCE
    const authUrl = new URL(authorizationEndpoint);
    authUrl.searchParams.set("client_id", oauth2Config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", args.scopes.replace(/,/g, " "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline");

    await new Promise<void>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url?.startsWith("/callback")) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }

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

          // Exchange code for tokens (client-side, no client_secret)
          const tokens = await exchangeCodeForTokens({
            tokenEndpoint,
            code,
            redirectUri,
            clientId: oauth2Config.clientId,
            codeVerifier,
          });

          // Register tokens on the platform
          const expiresAt = tokens.expires_in
            ? create(TimestampSchema, {
                seconds: BigInt(Math.floor(Date.now() / 1000) + tokens.expires_in),
              })
            : undefined;

          await client.registerAuthConnectionSession({
            workspaceId,
            connectionName: args.name,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? "",
            expiresAt,
          });

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Authorization successful</h1><p>You can close this window.</p></body></html>",
          );
          resolve();
        } catch (err) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h1>Authorization failed</h1><p>${err instanceof Error ? err.message : "Unknown error"}</p></body></html>`,
          );
          reject(err);
        } finally {
          server.close();
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
        reject(err);
      });

      server.listen(args.port, async () => {
        const authorizeUrl = authUrl.toString();
        logger.info(`Opening browser for authorization:\n\n${authorizeUrl}\n`);
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
