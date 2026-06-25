import type { IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME } from "../../config.js";
import { registerAllTools } from "../../tools/index.js";

function setCORSHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export async function POST(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  setCORSHeaders(res);

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
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
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
