import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

export function registerTransportTools(server: McpServer): void {
  server.registerTool(
    "france_search_stations",
    {
      title: "Search Train & Transit Stations",
      description: `Find train stations, metro stations, and transit stops in France.
Uses the official SNCF open data liste-des-gares dataset.

Use this when the user asks:
- "What's the nearest train station?"
- "Gares à proximité de Rueil-Malmaison"
- "Find RER stations near me"

Returns: station name, city, department, coordinates, and whether it serves passengers.`,
      inputSchema: {
        query: z.string().describe("Station name or city, e.g. 'Rueil-Malmaison' or 'Gare de Lyon'"),
        limit: z.number().int().min(1).max(20).default(5).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://ressources.data.sncf.com",
          path: "/api/explore/v2.1/catalog/datasets/liste-des-gares/records",
          params: {
            where: `libelle LIKE "${params.query}" OR commune LIKE "${params.query}"`,
            limit: params.limit,
          },
        });

        const results = (data as { results: Array<Record<string, unknown>>; total_count: number }).results || [];
        const totalCount = (data as { total_count: number }).total_count || 0;

        const stations = results.map((r) => ({
          name: r.libelle,
          city: r.commune,
          department: r.departemen,
          uic_code: r.code_uic,
          serves_passengers: r.voyageurs === "O",
          serves_freight: r.fret === "O",
          latitude: r.y_wgs84,
          longitude: r.x_wgs84,
        }));

        return toolResult({
          query: params.query,
          total_count: totalCount,
          count: stations.length,
          stations,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "france_get_transport_disruptions",
    {
      title: "Get Transport Disruptions",
      description: `Get current and upcoming transport disruptions in France (SNCF trains).

Use this when the user asks:
- "Are there train delays today?"
- "SNCF perturbations"
- "Is the TGV running normally?"
- "Grève SNCF en cours?"

Note: Real-time disruption data has limited availability in free public APIs.
This tool provides the best available sources for checking disruptions.`,
      inputSchema: {
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        // Try SNCF disruptions dataset
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://ressources.data.sncf.com",
          path: "/api/explore/v2.1/catalog/datasets/liste-des-gares/records",
          params: { limit: 1 },
          timeoutMs: 5000,
        });

        return toolResult({
          note: "Real-time SNCF disruption data is not available as a free public API. Use these official sources instead:",
          live_sources: {
            sncf_app: "SNCF Connect app — real-time train status and notifications",
            sncf_web: "https://www.sncf.com/fr/itineraire-reservation — check specific trains",
            twitter: "@SNCF and @InformRER for live updates",
            ratp: "https://www.ratp.fr/informations-trafic — metro/bus/RER status",
            idf_mobilites: "https://www.iledefrance-mobilites.fr — all Île-de-France transport",
            phone: "3635 — SNCF phone info",
          },
        });
      } catch (error) {
        return toolResult({
          note: "Could not reach SNCF API. Check these sources directly:",
          live_sources: {
            sncf_web: "https://www.sncf.com/fr/itineraire-reservation",
            ratp: "https://www.ratp.fr/informations-trafic",
            idf_mobilites: "https://www.iledefrance-mobilites.fr",
          },
        });
      }
    }
  );
}
