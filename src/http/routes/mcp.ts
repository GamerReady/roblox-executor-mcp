import type { IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME } from "../../config.js";
import { registerAllTools } from "../../tools/index.js";
import { readJsonBody } from "../body.js";

export async function POST(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
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
    req.headers["accept"] = "application/json, text/event-stream";
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
