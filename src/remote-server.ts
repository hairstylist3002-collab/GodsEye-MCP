import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// --- 1. SETUP SUPABASE ---
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const RESTRICT_TO_USER_ID = process.env.GODSEYE_USER_ID;

const app = express();
app.use(cors());

// --- 2. SETUP MCP SERVER ---
const server = new Server({
  name: "godseye-remote",
  version: "1.0.0",
}, {
  capabilities: { tools: {} }
});

// --- 3. DEFINE THE TOOL (The "Menu") ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: "get_winning_dna",
      description: "Fetches the 'Winning Content DNA' (AEO Blueprints) for a specific product using its Unique ID.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { 
            type: "string", 
            description: "The UUID of the product (e.g., '02f92e70...')." 
          }
        },
        required: ["product_id"]
      }
    }]
  };
});

// --- 4. HANDLE THE REQUEST (The "Logic") ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_winning_dna") {
    // @ts-ignore
    const productId = request.params.arguments.product_id;

    try {
      // [LOGIC COPIED FROM YOUR LOCAL SERVER]
      
      // Step A: Verify Product
      let query = supabase
        .from("products")
        .select("id, product_name, user_id")
        .eq("id", productId)
        .maybeSingle();

      const { data: productData, error: productError } = await query;

      if (productError) {
        return { content: [{ type: "text", text: `Database Error: ${productError.message}` }], isError: true };
      }
      if (!productData) {
        return { content: [{ type: "text", text: `Access Denied: Product ID '${productId}' not found.` }], isError: true };
      }
      if (RESTRICT_TO_USER_ID && productData.user_id !== RESTRICT_TO_USER_ID) {
        return { content: [{ type: "text", text: `Unauthorized Access.` }], isError: true };
      }

      // Step B: Fetch DNA
      const [googleResult, perplexityResult] = await Promise.all([
        supabase.from("product_analysis_dna_google").select("dna_blueprint, created_at").eq("product_id", productId).order("created_at", { ascending: false }),
        supabase.from("product_analysis_dna_perplexity").select("dna_blueprint, created_at").eq("product_id", productId).order("created_at", { ascending: false })
      ]);

      if (googleResult.error) throw new Error(`Google DB Error: ${googleResult.error.message}`);
      if (perplexityResult.error) throw new Error(`Perplexity DB Error: ${perplexityResult.error.message}`);

      // Step C: Format Response
      const googleRows = googleResult.data || [];
      const perpRows = perplexityResult.data || [];

      if (googleRows.length === 0 && perpRows.length === 0) {
        return { content: [{ type: "text", text: `Product Verified ('${productData.product_name}'), but no DNA analysis found.` }] };
      }

      let fullResponse = `=== GODSEYE BLUEPRINTS FOR: ${productData.product_name.toUpperCase()} ===\n`;
      fullResponse += `Product ID: ${productId}\n\n`;

      const appendBlueprints = (sourceName: string, rows: any[]) => {
        rows.forEach((row, index) => {
          fullResponse += `[SOURCE: ${sourceName} | RUN #${index + 1}]\n`;
          fullResponse += `Generated At: ${row.created_at}\n`;
          fullResponse += `Blueprint Data:\n${JSON.stringify(row.dna_blueprint, null, 2)}\n`;
          fullResponse += `\n--------------------------------------------\n\n`;
        });
      };

      appendBlueprints("GOOGLE", googleRows);
      appendBlueprints("PERPLEXITY", perpRows);

      return { content: [{ type: "text", text: fullResponse }] };

    } catch (err: any) {
      return { content: [{ type: "text", text: `System Error: ${err.message}` }], isError: true };
    }
  }

  throw new Error("Tool not found");
});

// --- 5. START EXPRESS SERVER ---
let transport: SSEServerTransport;

app.get("/sse", async (req, res) => {
  console.log("New SSE connection");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GodsEye Remote running on port ${PORT}`);
});
