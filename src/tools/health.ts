import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

export function registerHealthTools(server: McpServer): void {
  server.registerTool(
    "france_search_doctors",
    {
      title: "Search Doctors & Health Professionals",
      description: `Find doctors, dentists, specialists in France. Uses Annuaire Santé (CNAM) on OpenDataSoft.
Use when user asks for dermatologist, dentist, médecin généraliste, etc.
Returns: name, specialty, address, phone, sector (1=no extra fees, 2=extra fees possible).`,
      inputSchema: {
        specialty: z.string().optional().describe("E.g. 'Médecin généraliste', 'Chirurgien-dentiste', 'Dermatologue'"),
        city: z.string().optional().describe("City name"),
        department: z.string().optional().describe("Department code, e.g. '92'"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const w: string[] = [];
        if (params.city) w.push(`commune LIKE "${params.city}"`);
        if (params.department) w.push(`dep_code = "${params.department}"`);
        if (params.specialty) w.push(`libelle_profession LIKE "${params.specialty}"`);
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://public.opendatasoft.com",
          path: "/api/explore/v2.1/catalog/datasets/medecins/records",
          params: { where: w.length > 0 ? w.join(" AND ") : undefined, limit: params.limit },
        });
        const results = (data as any).results || [];
        const seen = new Set<string>();
        const doctors = results.map((r: any) => ({
          name: r.nom, specialty: r.libelle_profession, address: r.adresse,
          city: r.commune, department: r.dep_code, phone: r.column_10 || null,
          sector: r.column_14 || null, sesam_vitale: r.column_16 || null,
          coordinates: r.coordonnees || null,
        })).filter((d: any) => { const k = `${d.name}|${d.address}`; if (seen.has(k)) return false; seen.add(k); return true; });
        return toolResult({ query: { specialty: params.specialty, city: params.city }, total_count: (data as any).total_count || 0, count: doctors.length, doctors, tip: "Secteur 1 = no extra fees. Secteur 2 = possible extra fees." });
      } catch (error) { return toolError(error); }
    }
  );

  server.registerTool(
    "france_find_pharmacies",
    {
      title: "Find Pharmacies Near You",
      description: `Find pharmacies near a location in France using OpenStreetMap data.
Use when user asks for pharmacy, pharmacie de garde, pharmacie ouverte.
Just provide a city name — no coordinates needed.
For pharmacies de garde (nights/Sundays): call 3237 or visit monpharmacien-idf.fr.`,
      inputSchema: {
        city: z.string().describe("City name, e.g. 'Rueil-Malmaison'"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=pharmacie+${encodeURIComponent(params.city)}&format=json&limit=${params.limit}&countrycodes=fr&addressdetails=1&extratags=1`,
          { headers: { "User-Agent": "france-life-mcp/1.0", "Accept": "application/json" } }
        );
        if (!response.ok) return toolError({ source: "nominatim.openstreetmap.org", status: response.status, message: "Nominatim API error" });
        const results = await response.json() as Array<Record<string, unknown>>;
        const pharmacies = results.map((r) => {
          const addr = (r.address || {}) as Record<string, string>;
          const extra = (r.extratags || {}) as Record<string, string>;
          return {
            name: r.name || r.display_name || "Pharmacie",
            address: [addr.house_number, addr.road, addr.postcode, addr.city || addr.town || addr.village].filter(Boolean).join(" ") || String(r.display_name || "").split(",").slice(0,3).join(","),
            phone: extra.phone || extra["contact:phone"] || null,
            opening_hours: extra.opening_hours || null,
            latitude: parseFloat(String(r.lat)),
            longitude: parseFloat(String(r.lon)),
          };
        });
        return toolResult({ query: { city: params.city }, count: pharmacies.length, pharmacies,
          pharmacie_de_garde_tip: "For on-duty pharmacies (nights/Sundays/holidays): call 3237, visit monpharmacien-idf.fr (Île-de-France), or check your mairie's door posting." });
      } catch (error) { return toolError(error); }
    }
  );
}
