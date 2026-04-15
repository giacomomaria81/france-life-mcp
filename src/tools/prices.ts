import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResult } from "../services/api-client.js";

export function registerPricesTools(server: McpServer): void {
  server.registerTool(
    "france_get_fuel_prices",
    {
      title: "Get Fuel Prices Near You",
      description: `Help find fuel prices in France.

The official fuel price data (prix-carburants.gouv.fr) is only available as a bulk XML download,
not as a queryable API. This tool provides the best resources for finding cheap fuel.

Use this when the user asks:
- "Cheapest diesel near me"
- "Prix du SP95 dans le 92"
- "Where to fill up in Rueil-Malmaison?"

The tool returns direct links to the best fuel price comparison tools.`,
      inputSchema: {
        department: z.string().optional().describe("Department number, e.g. '92'"),
        city: z.string().optional().describe("City name"),
        fuel_type: z.enum(["SP95", "SP98", "E10", "E85", "Gazole", "GPLc"]).optional()
          .describe("Fuel type"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const searchUrl = params.department
        ? `https://www.prix-carburants.gouv.fr/recherche?dep=${params.department}`
        : params.city
          ? `https://www.prix-carburants.gouv.fr/recherche?city=${encodeURIComponent(params.city)}`
          : "https://www.prix-carburants.gouv.fr/";

      return toolResult({
        query: { department: params.department, city: params.city, fuel_type: params.fuel_type },
        note: "Fuel price data is available from the government as a bulk file only (12MB XML). For real-time price comparison, use these sources:",
        sources: {
          official: searchUrl,
          official_name: "prix-carburants.gouv.fr — Official government fuel price site",
          zagaz: "https://www.zagaz.com — Community-reported prices with map",
          essence_app: "Essence&CO app (iOS/Android) — Real-time prices with route planning",
        },
        tips: [
          "Supermarket fuel (Leclerc, Carrefour, Intermarché) is typically 5-10 cents/L cheaper than branded stations (Total, Shell, BP).",
          "Costco has the cheapest fuel in France if you have a membership.",
          params.fuel_type === "E85"
            ? "E85 is ~0.70€/L but requires a flex-fuel vehicle or conversion kit (~800-1200€)."
            : null,
        ].filter(Boolean),
      });
    }
  );
}
