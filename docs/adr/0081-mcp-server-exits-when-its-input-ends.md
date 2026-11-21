# The MCP server exits when its input ends, after answering pending calls

The MCP SDK's `StdioServerTransport` does not notice its input ending. When a client goes away without a goodbye, the server would outlive it. `serveMcp` in `cli/mcp.ts` therefore listens for stdin's `end` and `close` itself and exits. Before exiting, it waits for the tool calls being answered (`pending`, counted by `guard`), so a script that pipes its requests in and closes still gets every answer. Video jobs are detached and finish whether or not the server is still there.
