/**
 * Remote MCP endpoint.
 *
 * Drop this file at: src/http/routes/mcp.ts
 *
 * Exposes this server over the MCP "Streamable HTTP" transport at
 * POST / GET / DELETE /mcp, so AI clients (claude.ai, Claude Desktop,
 * Claude Code, Cowork, etc.) can connect directly to this server's public
 * URL as a remote MCP server / custom connector — no local install and no
 * --baseurl relay process required.
 *
 * The router in src/http/router.ts auto-discovers this file and derives the
 * URL path from its location, so this alone is enough to register
 * GET/POST/DELETE/OPTIONS handlers at /mcp. No other wiring needed.
 *
 * SECURITY: this endpoint lets whoever can reach it run arbitrary Luau in
 * whatever Roblox client is connected, read scripts, screenshot windows, etc.
 * Set the MCP_REMOTE_KEY environment variable (see config.ts patch in
 * REMOTE-MCP-SETUP.md) before exposing this publicly. Callers must then
 * provide the key either as:
 *   - a query string:           https://your-app.onrender.com/mcp?key=YOUR_KEY
 *   - an Authorization header:  Authorization: Bearer YOUR_KEY
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { MCP_REMOTE_KEY, SERVER_NAME } from "../../config.js";
import { registerAllTools } from "../../tools/index.js";
import { readJsonBody } from "../body.js";

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

// One McpServer + transport pair per connected client session. Sessions are
// in-memory only — they reset on redeploy/restart, which is fine; the client
// just re-initializes.
const sessions = new Map<string, McpSession>();

if (!MCP_REMOTE_KEY) {
  console.error(
    "[MCP-HTTP] WARNING: MCP_REMOTE_KEY is not set. The /mcp endpoint is open to " +
      "anyone who knows this server's URL. Set the MCP_REMOTE_KEY environment " +
      "variable before exposing this server publicly."
  );
}

function extractKey(req: IncomingMessage, url: URL): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice("bearer ".length).trim();
  }
  return url.searchParams.get("key");
}

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (!MCP_REMOTE_KEY) return true;
  const provided = extractKey(req, url);
  return provided !== null && provided === MCP_REMOTE_KEY;
}

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, mcp-protocol-version"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

async function createSession(): Promise<McpSession> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: "2.0.0",
    description:
      "Expose MCP tools for inspecting, executing Luau in, and interacting with connected Roblox game clients.",
  });
  registerAllTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport });
      console.error(`[MCP-HTTP] Session initialized: ${sessionId}`);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
      console.error(`[MCP-HTTP] Session closed: ${transport.sessionId}`);
    }
  };

  await server.connect(transport);
  return { server, transport };
}

export async function OPTIONS(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(res);
  res.writeHead(204);
  res.end();
}

export async function POST(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  applyCors(res);
  if (!isAuthorized(req, url)) {
    sendJsonRpcError(res, 401, -32001, "Unauthorized. Pass ?key=... or 'Authorization: Bearer <key>'.");
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJsonRpcError(res, 400, -32700, "Invalid JSON body.");
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

  if (existing) {
    await existing.transport.handleRequest(req, res, body);
    return;
  }

  if (!sessionId && isInitializeRequest(body)) {
    const session = await createSession();
    await session.transport.handleRequest(req, res, body);
    return;
  }

  sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided.");
}

export async function GET(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  applyCors(res);
  if (!isAuthorized(req, url)) {
    sendJsonRpcError(res, 401, -32001, "Unauthorized. Pass ?key=... or 'Authorization: Bearer <key>'.");
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
  if (!session) {
    sendJsonRpcError(res, 400, -32000, "Invalid or missing Mcp-Session-Id header.");
    return;
  }
  await session.transport.handleRequest(req, res);
}

export async function DELETE(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  applyCors(res);
  if (!isAuthorized(req, url)) {
    sendJsonRpcError(res, 401, -32001, "Unauthorized. Pass ?key=... or 'Authorization: Bearer <key>'.");
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
  if (!session) {
    sendJsonRpcError(res, 400, -32000, "Invalid or missing Mcp-Session-Id header.");
    return;
  }
  await session.transport.handleRequest(req, res);
  sessions.delete(sessionId as string);
}
