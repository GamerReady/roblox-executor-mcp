import type { IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME } from "../../config.js";
import { registerAllTools } from "../../tools/index.js";
import { readJsonBody } from "../body.js";

/**
 * Remote MCP endpoint for AI clients connecting over the network instead of
 * spawning this process locally via stdio.
 *
 * Set MCP_SHARED_SECRET as an env var to require either:
 *   - header: Authorization: Bearer <secret>
 *   - query:  /mcp?key=<secret>
 * Leave it unset only for quick testing — this server can run arbitrary code
 * in your Roblox client, so an open /mcp on the public internet means anyone
 * with the URL can do the same.
 */
const SHARED_SECRET = process.env.MCP_SHARED_SECRET;

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (!SHARED_SECRET) return true;
  if (req.headers["authorization"] === `Bearer ${SHARED_SECRET}`) return true;
  return url.searchParams.get("key") === SHARED_SECRET;
}

// One McpServer + one stateless transport for the whole process lifetime.
// sessionIdGenerator is left undefined because none of this server's tools
// depend on per-conversation state — they all act on whichever Roblox
// client is currently "active" in the shared registry.
const mcpHttpServer = new McpServer({
  name: SERVER_NAME,
  version: "2.0.0",
  description: "Roblox Executor MCP — remote HTTP endpoint",
});
registerAllTools(mcpHttpServer);

const mcpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

let connected: Promise<void> | null = null;
function ensureConnected(): Promise<void> {
  if (!connected) connected = mcpHttpServer.connect(mcpTransport);
  return connected;
}

export async function POST(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  if (!isAuthorized(req, url)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  await ensureConnected();
  const body = await readJsonBody<unknown>(req);
  await mcpTransport.handleRequest(req, res, body);
}
