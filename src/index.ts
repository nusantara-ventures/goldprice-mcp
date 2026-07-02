#!/usr/bin/env node

// @goldprice/mcp — stdio ↔ HTTP Streamable bridge for the goldprice.dev
// Model Context Protocol server. Thin proxy: the bridge holds no tool
// definitions, no schemas, no business logic. It opens a stdio MCP server
// for the local client (Claude Desktop / Cursor / etc.) and forwards every
// JSON-RPC method to https://api.goldprice.dev/v1/mcp/ via the SDK's
// Streamable HTTP transport. Authentication is a Bearer header built from
// the GP_KEY environment variable.
//
// Canonical docs: https://goldprice.dev/docs/mcp
//
// Design posture:
//   - Logs only to stderr. Stdout is the stdio MCP channel and must stay
//     clean of anything that isn't framed JSON-RPC.
//   - No telemetry. No retry storms. One forwarded call per client call.
//   - HTTP-level failures (401 / 403 / 429) surface as MCP errors so the
//     calling agent gets a descriptive message instead of silence.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PKG_NAME = "@goldprice/mcp";
const PKG_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://api.goldprice.dev";

type Stderr = (message: string) => void;

const log: Stderr = (message) => {
  // Trailing newline for line-buffered stderr consumers (Claude Desktop
  // surfaces MCP server stderr in its logs).
  process.stderr.write(`[${PKG_NAME}] ${message}\n`);
};

function resolveEndpoint(base: string): URL {
  let trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) trimmed = DEFAULT_BASE_URL;
  if (trimmed.endsWith("/v1/mcp")) {
    trimmed = trimmed + "/";
  } else if (!trimmed.endsWith("/v1/mcp/")) {
    trimmed = trimmed + "/v1/mcp/";
  }
  return new URL(trimmed);
}

// Wraps an upstream call so HTTP failures and native errors surface as
// typed MCP errors to the stdio client.
async function forward<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof McpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/\b401\b/.test(message)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Unauthorized (${operation}) — check that GP_KEY is a valid ga_live_* API key. See https://goldprice.dev/docs/mcp#troubleshoot`,
      );
    }
    if (/\b403\b/.test(message)) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Forbidden (${operation}) — your tier does not include this tool. Upgrade at https://goldprice.dev/pricing`,
      );
    }
    if (/\b429\b/.test(message)) {
      throw new McpError(
        ErrorCode.InternalError,
        `Rate limited (${operation}) — back off and retry. Per-tier limits at https://goldprice.dev/pricing`,
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Upstream error (${operation}): ${message}`,
    );
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GP_KEY;
  if (!apiKey) {
    log(
      "GP_KEY is required. Set it in your MCP client config:\n" +
        '  "env": { "GP_KEY": "ga_live_..." }\n' +
        "Get a key at https://goldprice.dev/pricing — Free tier includes MCP access.",
    );
    process.exit(1);
    return;
  }

  const baseUrl = process.env.GP_BASE_URL ?? DEFAULT_BASE_URL;
  const endpoint = resolveEndpoint(baseUrl);

  const timeoutMs = Number.parseInt(process.env.GP_TIMEOUT ?? "10000", 10);
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    log(
      `GP_TIMEOUT must be a positive integer in milliseconds. Got: ${process.env.GP_TIMEOUT}`,
    );
    process.exit(1);
    return;
  }

  // 1. Connect to upstream HTTP MCP.
  const upstream = new Client(
    { name: `${PKG_NAME}-bridge`, version: PKG_VERSION },
    { capabilities: {} },
  );

  const upstreamTransport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": `${PKG_NAME}/${PKG_VERSION} (stdio-bridge)`,
      },
    },
  });

  try {
    await upstream.connect(upstreamTransport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to connect to ${endpoint.href}: ${message}`);
    if (/\b401\b|\b403\b|invalid_api_key|unauthorized|forbidden/i.test(message)) {
      log(
        "Check that GP_KEY is a valid ga_live_* API key (not the prefix-only copy shown on /account).",
      );
    }
    process.exit(1);
    return;
  }

  log(`Connected to ${endpoint.href} (timeout ${timeoutMs}ms).`);

  // 2. Introspect upstream capabilities so the stdio handshake advertises
  //    only what the backend actually supports.
  const serverCapabilities = upstream.getServerCapabilities() ?? {};
  const bridgeCapabilities: Record<string, Record<string, unknown>> = {};
  if (serverCapabilities.tools) bridgeCapabilities.tools = {};
  if (serverCapabilities.resources) bridgeCapabilities.resources = {};
  if (serverCapabilities.prompts) bridgeCapabilities.prompts = {};
  if (serverCapabilities.logging) bridgeCapabilities.logging = {};
  if (serverCapabilities.completions) bridgeCapabilities.completions = {};

  const bridge = new Server(
    { name: "goldprice", version: PKG_VERSION },
    { capabilities: bridgeCapabilities },
  );

  // 3. Wire JSON-RPC method forwarders. One handler per MCP method we
  //    proxy; unsupported methods fall through to the SDK default
  //    (returns MethodNotFound), so unadvertised capabilities stay
  //    honest.
  if (serverCapabilities.tools) {
    bridge.setRequestHandler(ListToolsRequestSchema, async () =>
      forward("tools/list", () => upstream.listTools()),
    );
    bridge.setRequestHandler(CallToolRequestSchema, async (request) =>
      forward(`tools/call(${request.params.name})`, () =>
        upstream.callTool(request.params),
      ),
    );
  }

  if (serverCapabilities.resources) {
    bridge.setRequestHandler(ListResourcesRequestSchema, async () =>
      forward("resources/list", () => upstream.listResources()),
    );
    bridge.setRequestHandler(ListResourceTemplatesRequestSchema, async () =>
      forward("resources/templates/list", () => upstream.listResourceTemplates()),
    );
    bridge.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      forward(`resources/read(${request.params.uri})`, () =>
        upstream.readResource(request.params),
      ),
    );
  }

  if (serverCapabilities.prompts) {
    bridge.setRequestHandler(ListPromptsRequestSchema, async () =>
      forward("prompts/list", () => upstream.listPrompts()),
    );
    bridge.setRequestHandler(GetPromptRequestSchema, async (request) =>
      forward(`prompts/get(${request.params.name})`, () =>
        upstream.getPrompt(request.params),
      ),
    );
  }

  if (serverCapabilities.completions) {
    bridge.setRequestHandler(CompleteRequestSchema, async (request) =>
      forward("completion/complete", () => upstream.complete(request.params)),
    );
  }

  // 4. Connect stdio transport.
  const stdio = new StdioServerTransport();
  await bridge.connect(stdio);

  // 5. Graceful shutdown — close both transports on SIGINT / SIGTERM so
  //    open SSE streams don't linger after the local client disconnects.
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, shutting down.`);
    try {
      await bridge.close();
    } catch {
      /* noop */
    }
    try {
      await upstream.close();
    } catch {
      /* noop */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  log(`Fatal: ${message}`);
  process.exit(1);
});
