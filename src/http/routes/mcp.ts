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
 *
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

  // Stateless mode (sessionIdGenerator: undefined) requires a NEW McpServer
  // + transport per request. The SDK enforces single-use on stateless
  // transports internally — reusing one across requests throws on every
  // call after the first, which is what was producing the 500s.
  const mcpServer = new McpServer({
    name: SERVER_NAME,
    version: "2.0.0",
    description: "Roblox Executor MCP — remote HTTP endpoint",
  });
  registerAllTools(mcpServer);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    mcpServer.close();
  });

  try {
    const body = await readJsonBody<unknown>(req);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        })
      );
    }
  }
}
