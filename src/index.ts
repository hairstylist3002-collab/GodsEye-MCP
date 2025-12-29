#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// Optional: Lock this MCP instance to a specific user for extra security
const RESTRICT_TO_USER_ID = process.env.GODSEYE_USER_ID; 

const server = new McpServer({
  name: "godseye-mcp",
  version: "1.0.0",
});

server.tool(
  "get_winning_dna",
  "Fetches the 'Winning Content DNA' (AEO Blueprints) for a specific product using its Unique ID. This is a secure operation.",
  {
    product_id: z.string().describe("The UUID of the product (e.g., '02f92e70-7b53...'). found in your GodsEye dashboard."),
  },
  async ({ product_id }) => {
    try {
      // --- STEP 1: SECURE VERIFICATION ---
      // We query by ID directly. 
      let query = supabase
        .from("products")
        .select("id, product_name, user_id")
        .eq("id", product_id)
        .maybeSingle();

      const { data: productData, error: productError } = await query;

      if (productError) {
        return {
          content: [{ type: "text", text: `Database Error: ${productError.message}` }],
          isError: true,
        };
      }

      if (!productData) {
        return {
          content: [{ type: "text", text: `Access Denied: Product ID '${product_id}' not found.` }],
          isError: true,
        };
      }

      // [SECURITY CHECK] If you set GODSEYE_USER_ID in .env, this blocks unauthorized access
      if (RESTRICT_TO_USER_ID && productData.user_id !== RESTRICT_TO_USER_ID) {
         return {
          content: [{ type: "text", text: `Unauthorized: This MCP instance is not authorized to access this product.` }],
          isError: true,
        };
      }

      // --- STEP 2: FETCH DNA BLUEPRINTS ---
      // Now that we have verified the ID exists, we fetch the data
      const [googleResult, perplexityResult] = await Promise.all([
        supabase
          .from("product_analysis_dna_google")
          .select("dna_blueprint, created_at")
          .eq("product_id", product_id) // Use the validated ID
          .order("created_at", { ascending: false }),
        
        supabase
          .from("product_analysis_dna_perplexity")
          .select("dna_blueprint, created_at")
          .eq("product_id", product_id)
          .order("created_at", { ascending: false })
      ]);

      if (googleResult.error) throw new Error(`Google Table Error: ${googleResult.error.message}`);
      if (perplexityResult.error) throw new Error(`Perplexity Table Error: ${perplexityResult.error.message}`);

      // --- STEP 3: FORMAT RESPONSE ---
      const googleRows = googleResult.data || [];
      const perpRows = perplexityResult.data || [];

      if (googleRows.length === 0 && perpRows.length === 0) {
        return {
          content: [{ type: "text", text: `Product Verified ('${productData.product_name}'), but no DNA analysis found.` }],
        };
      }

      let fullResponse = `=== GODSEYE BLUEPRINTS FOR: ${productData.product_name.toUpperCase()} ===\n`;
      fullResponse += `Product ID: ${product_id}\n\n`;

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

      return {
        content: [{ type: "text", text: fullResponse }],
      };

    } catch (err: any) {
      return {
        content: [{ type: "text", text: `System Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GodsEye Secure MCP Server running...");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});