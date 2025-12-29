import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express from "express";
// ... import your Supabase client and logic here ...

const app = express();
app.use(cors());

// 1. Initialize your MCP Server (Same logic as your local one)
const server = new Server({
  name: "godseye-remote",
  version: "1.0.0",
}, {
  capabilities: { tools: {} }
});

// 2. Add your existing Tool Handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: "get_winning_dna",
      description: "Fetches winning DNA from Supabase",
      inputSchema: { type: "object", properties: { product_name: { type: "string" } } }
    }]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // ... Your existing Supabase logic here ...
  return { content: [{ type: "text", text: "Result from remote server" }] };
});

// 3. Set up the SSE Transport (The Magic Part)
let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  console.log("Received message");
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GodsEye Remote running on port ${PORT}`);
});