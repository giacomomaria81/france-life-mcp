import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

// BAN API base - using the Géoplateforme endpoint (successor to api-adresse.data.gouv.fr)
const BAN_BASE = "https://api-adresse.data.gouv.fr";

interface BanFeature {
  type: string;
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    label: string;
    score: number;
    housenumber?: string;
    id: string;
    name: string;
    postcode: string;
    citycode: string;
    city: string;
    context: string;
    type: string;
    importance: number;
    street?: string;
  };
}

interface BanResponse {
  type: string;
  features: BanFeature[];
}

function formatBanResult(feature: BanFeature) {
  const { properties: p, geometry: g } = feature;
  return {
    label: p.label,
    housenumber: p.housenumber || null,
    street: p.street || p.name,
    postcode: p.postcode,
    city: p.city,
    city_code: p.citycode,
    context: p.context,
    latitude: g.coordinates[1],
    longitude: g.coordinates[0],
    score: p.score,
    type: p.type,
  };
}

export function registerAddressTools(server: McpServer): void {
  server.registerTool(
    "france_search_address",
    {
      title: "Search French Address",
      description: `Geocode a French address — convert a text address into GPS coordinates and structured data.
Uses the Base Adresse Nationale (BAN), the official French government address database covering 25+ million addresses.

Use this when the user asks:
- "Where is 20 avenue de Ségur, Paris?"
- "Find the coordinates of this address"
- "What's the postal code for Rueil-Malmaison?"
- Any time you need to convert a French address to coordinates for other tools

Returns: label, street, postcode, city, département, latitude, longitude, confidence score.`,
      inputSchema: {
        q: z.string().min(3).describe("Address to search, e.g. '20 avenue de Ségur, Paris' or '92500 Rueil-Malmaison'"),
        limit: z.number().int().min(1).max(10).default(5).describe("Maximum results to return (default 5)"),
        postcode: z.string().optional().describe("Filter by postal code to narrow results, e.g. '75007'"),
        type: z.enum(["housenumber", "street", "locality", "municipality"]).optional().describe("Filter by result type"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<BanResponse>({
          baseUrl: BAN_BASE,
          path: "/search/",
          params: { q: params.q, limit: params.limit, postcode: params.postcode, type: params.type },
        });

        if (!data.features?.length) {
          return toolResult({ results: [], message: `No addresses found for "${params.q}". Try a simpler query or check spelling.` });
        }

        return toolResult({
          query: params.q,
          count: data.features.length,
          results: data.features.map(formatBanResult),
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "france_reverse_geocode",
    {
      title: "Reverse Geocode (Coordinates → Address)",
      description: `Convert GPS coordinates into a French address.
Uses the Base Adresse Nationale (BAN).

Use this when:
- You have latitude/longitude and need the address
- The user shares a location and asks "what's at this location?"
- You need to find the city/commune from coordinates for other tools`,
      inputSchema: {
        lat: z.number().min(41).max(51.5).describe("Latitude (France range: 41°N to 51.5°N)"),
        lon: z.number().min(-5.5).max(10).describe("Longitude (France range: -5.5°W to 10°E)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<BanResponse>({
          baseUrl: BAN_BASE,
          path: "/reverse/",
          params: { lat: params.lat, lon: params.lon },
        });

        if (!data.features?.length) {
          return toolResult({ results: [], message: "No address found at these coordinates. They may be outside France or in an unaddressed area." });
        }

        return toolResult({
          coordinates: { latitude: params.lat, longitude: params.lon },
          results: data.features.map(formatBanResult),
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
