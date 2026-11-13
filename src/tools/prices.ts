import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

const FUELS = { Gazole: "gazole", SP95: "sp95", SP98: "sp98", E10: "e10", E85: "e85", GPLc: "gplc" } as const;
type Fuel = keyof typeof FUELS;
const DATASET = "/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export function registerPricesTools(server: McpServer): void {
  server.registerTool(
    "france_get_fuel_prices",
    {
      title: "Get Fuel Prices Near You",
      description: `Get live fuel prices at French petrol stations, cheapest first.
Uses the official government feed (prix-carburants.gouv.fr), updated by the stations themselves.

Use this when the user asks:
- "Cheapest diesel near me"
- "Prix du SP95 dans le 92"
- "Where to fill up in Rueil-Malmaison?"

Give a city, or coordinates, or a department. With a city or coordinates the search covers a radius
around that point. The feed has no brand names: stations are identified by address.

Returns: stations sorted by price for the chosen fuel, with address, distance, all prices and when each was last updated.`,
      inputSchema: {
        city: z.string().optional().describe("City name, e.g. 'Garches'. Add the postcode if the name is common."),
        latitude: z.number().min(-90).max(90).optional().describe("Latitude, as an alternative to city"),
        longitude: z.number().min(-180).max(180).optional().describe("Longitude, as an alternative to city"),
        department: z.string().optional().describe("Department number, e.g. '92'. Used only when no city or coordinates are given."),
        fuel_type: z.enum(["SP95", "SP98", "E10", "E85", "Gazole", "GPLc"]).default("E10").describe("Fuel to sort by"),
        radius_km: z.number().min(1).max(50).default(5).describe("Search radius around the city or coordinates"),
        limit: z.number().int().min(1).max(20).default(8).describe("Max stations"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const fuel = params.fuel_type as Fuel;
        const field = FUELS[fuel];
        let lat = params.latitude;
        let lon = params.longitude;
        let place: string | undefined;
        if ((lat === undefined || lon === undefined) && params.city) {
          const geo = await apiFetch<{ features?: Array<{ geometry: { coordinates: [number, number] }; properties: { label?: string } }> }>({
            baseUrl: "https://api-adresse.data.gouv.fr",
            path: "/search/",
            params: { q: params.city, type: "municipality", limit: 1 },
          });
          const hit = geo.features?.[0];
          if (!hit) return toolResult({ query: params, error: `City not found: ${params.city}. Try with its postcode.` });
          [lon, lat] = hit.geometry.coordinates;
          place = hit.properties.label;
        }
        const here = lat !== undefined && lon !== undefined;
        if (!here && !params.department) {
          return toolResult({ error: "Give a city, coordinates, or a department number." });
        }
        if (params.department && !/^(\d{2,3}|2[AB])$/i.test(params.department)) {
          return toolResult({ error: "Department must be a number such as '92', '2A' or '974'." });
        }
        const where = here
          ? `within_distance(geom, geom'POINT(${lon} ${lat})', ${params.radius_km}km) and ${field}_prix is not null`
          : `code_departement='${params.department!.toUpperCase()}' and ${field}_prix is not null`;
        const data = await apiFetch<{ total_count?: number; results?: Array<Record<string, unknown>> }>({
          baseUrl: "https://data.economie.gouv.fr",
          path: DATASET,
          params: { where, order_by: `${field}_prix asc`, limit: params.limit },
          timeoutMs: 15000,
        });
        const rows = data.results || [];
        if (rows.length === 0) {
          return toolResult({
            query: { place: place ?? params.city ?? params.department, fuel, radius_km: here ? params.radius_km : undefined },
            error: `No station sells ${fuel} in this area according to the official feed. Try a wider radius.`,
          });
        }
        const stations = rows.map((r) => {
          const g = r.geom as { lat: number; lon: number } | undefined;
          const prices: Record<string, { price: number; updated: unknown }> = {};
          for (const [name, f] of Object.entries(FUELS)) {
            if (typeof r[`${f}_prix`] === "number") prices[name] = { price: r[`${f}_prix`] as number, updated: r[`${f}_maj`] };
          }
          return {
            address: `${r.adresse}, ${r.cp} ${r.ville}`,
            price: r[`${field}_prix`],
            updated: r[`${field}_maj`],
            distance_km: here && g ? km(lat!, lon!, g.lat, g.lon) : undefined,
            open_24h_automat: r.horaires_automate_24_24 === "Oui",
            all_prices: prices,
            latitude: g?.lat,
            longitude: g?.lon,
          };
        });
        return toolResult({
          query: { place: place ?? params.city ?? (here ? `${lat}, ${lon}` : `département ${params.department}`), fuel, radius_km: here ? params.radius_km : undefined },
          stations_selling_this_fuel: data.total_count,
          count: stations.length,
          cheapest: stations[0].price,
          unit: "€/L",
          stations,
          note: "Prices are declared by the stations; check the 'updated' date, a price several days old may have changed.",
          source: "prix-carburants.gouv.fr — flux instantané (data.economie.gouv.fr)",
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
