import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

export function registerCalendarTools(server: McpServer): void {
  server.registerTool(
    "france_get_public_holidays",
    {
      title: "Get French Public Holidays",
      description: `Get all jours fériés (public holidays) for a given year in France.
Uses the official French government calendar API.

Use this when the user asks:
- "When is the next public holiday?"
- "Is May 1st a holiday in France?"
- "Jours fériés 2026"
- "Can I make a pont (bridge) this month?"

Returns: date and name of each holiday + automatic pont (bridge day) detection.`,
      inputSchema: {
        year: z.number().int().min(2000).max(2050).describe("Year, e.g. 2026"),
        zone: z.enum(["metropole", "alsace-moselle", "guadeloupe", "guyane", "martinique", "mayotte", "nouvelle-caledonie", "la-reunion", "polynesie-francaise", "saint-barthelemy", "saint-martin", "wallis-et-futuna", "saint-pierre-et-miquelon"])
          .default("metropole")
          .describe("Zone — 'metropole' for mainland France"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, string>>({
          baseUrl: "https://calendrier.api.gouv.fr",
          path: `/jours-feries/${params.zone}/${params.year}.json`,
        });

        const holidays = Object.entries(data)
          .map(([date, name]) => {
            const d = new Date(date + "T12:00:00");
            const dayOfWeek = d.toLocaleDateString("fr-FR", { weekday: "long" });
            return { date, day_of_week: dayOfWeek, name };
          })
          .sort((a, b) => a.date.localeCompare(b.date));

        const ponts = holidays.filter((h) => {
          const d = new Date(h.date + "T12:00:00");
          const dow = d.getDay();
          return dow === 2 || dow === 4;
        }).map((h) => {
          const d = new Date(h.date + "T12:00:00");
          const isTuesday = d.getDay() === 2;
          const bridgeDate = new Date(d);
          bridgeDate.setDate(d.getDate() + (isTuesday ? -1 : 1));
          return {
            holiday: h.name,
            date: h.date,
            bridge_day: bridgeDate.toISOString().split("T")[0],
            tip: isTuesday ? "Take Monday off for a 4-day weekend" : "Take Friday off for a 4-day weekend",
          };
        });

        return toolResult({ year: params.year, zone: params.zone, count: holidays.length, holidays, possible_ponts: ponts });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "france_get_school_holidays",
    {
      title: "Get School Holidays",
      description: `Get school holidays (vacances scolaires) for a given academic year and zone.

Zones: A (Lyon, Grenoble, Bordeaux...), B (Lille, Nice, Nantes, Strasbourg...), C (Paris, Versailles, Créteil, Toulouse, Montpellier).
Tip: Rueil-Malmaison is Versailles academy = Zone C.

Use this when the user asks:
- "When are the next school holidays?"
- "Vacances de février zone C"
- "When do kids go back to school?"`,
      inputSchema: {
        year: z.number().int().min(2020).max(2050).describe("Start year of academic year, e.g. 2025 for 2025-2026"),
        zone: z.enum(["A", "B", "C"]).describe("School zone: A, B, or C"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://data.education.gouv.fr",
          path: "/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records",
          params: {
            where: `annee_scolaire = "${params.year}-${params.year + 1}" AND zones = "Zone ${params.zone}"`,
            order_by: "start_date",
            limit: 50,
          },
        });

        const results = (data as { results: Array<Record<string, string>> }).results || [];

        // DEDUP: each holiday appears once per academy within the zone
        const seen = new Set<string>();
        const holidays = results
          .filter((r) => {
            const key = `${r.description}|${r.start_date?.split("T")[0]}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((r) => ({
            description: r.description,
            start_date: r.start_date?.split("T")[0],
            end_date: r.end_date?.split("T")[0],
            zone: params.zone,
          }));

        return toolResult({
          academic_year: `${params.year}-${params.year + 1}`,
          zone: params.zone,
          count: holidays.length,
          holidays,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
