export async function POST(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  req.headers["accept"] = "application/json, text/event-stream"; // 👈 moved to top

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
