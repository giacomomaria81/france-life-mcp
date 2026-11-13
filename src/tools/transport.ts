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
      title: "Get Transport Disruptions (Île-de-France)",
      description: `Get current transport disruptions in Île-de-France: metro, RER, Transilien, tram, bus.
Uses the official Île-de-France Mobilités feed (PRIM).

Use this when the user asks:
- "Is the RER A running?"
- "Perturbations sur la ligne L"
- "Any metro problems right now?"

This feed needs a free API key from Île-de-France Mobilités (environment variable IDFM_API_KEY).
Without it, the tool says so and returns the official pages to check by hand. There is no free
public feed for SNCF long-distance trains: for TGV and Intercités, the tool returns the official pages.

Returns: lines currently disrupted, with severity, cause, message and period.`,
      inputSchema: {
        line: z.string().max(40).optional().describe("Line to look for, e.g. 'L', 'U', 'A', '13', 'T2'. Leave empty for all lines."),
        mode: z.enum(["Metro", "RapidTransit", "LocalTrain", "Tramway", "Bus"]).optional()
          .describe("Transport mode: Metro, RapidTransit (RER), LocalTrain (Transilien), Tramway, Bus"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max disruptions"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const pages = {
        idf_mobilites: "https://www.iledefrance-mobilites.fr/info-trafic — all Île-de-France lines",
        ratp: "https://www.ratp.fr/infos-trafic — metro, RER A and B, tram, bus",
        transilien: "https://www.transilien.com/fr/page-info-trafic — Transilien and RER C, D, E",
        sncf: "https://www.sncf-voyageurs.com/fr/voyagez-avec-nous/horaires-et-itineraires/ — TGV, Intercités, TER",
      };
      const key = process.env.IDFM_API_KEY;
      if (!key) {
        return toolResult({
          live_data: false,
          note: "Live disruptions need a free Île-de-France Mobilités key (IDFM_API_KEY), which is not set on this server. Check these official pages instead:",
          official_pages: pages,
        });
      }
      try {
        const data = await apiFetch<{ disruptions?: Array<Record<string, unknown>>; lines?: Array<Record<string, unknown>> }>({
          baseUrl: "https://prim.iledefrance-mobilites.fr",
          path: "/marketplace/disruptions_bulk/disruptions/v2",
          headers: { apikey: key },
          timeoutMs: 20000,
        });
        return toolResult({ live_data: true, ...currentDisruptions(data, params, new Date()), official_pages: pages, source: "Île-de-France Mobilités — PRIM, perturbations" });
      } catch (error) {
        return toolResult({
          live_data: false,
          note: "The Île-de-France Mobilités feed did not answer. Check these official pages:",
          detail: (error as { message?: string })?.message,
          official_pages: pages,
        });
      }
    }
  );
}

/** "20261113T074500" → Date (the feed gives Paris local time without an offset). */
function primDate(s: unknown): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(String(s ?? ""));
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) : null;
}

const plain = (html: unknown) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();

/**
 * Keep the disruptions in effect now, attach them to their lines, apply the filters.
 * The feed lists disruptions and, separately, lines with the ids of the disruptions touching them.
 */
export function currentDisruptions(
  data: { disruptions?: Array<Record<string, unknown>>; lines?: Array<Record<string, unknown>> },
  filter: { line?: string; mode?: string; limit: number },
  now: Date,
): { count: number; lines_checked: number; disruptions: Array<Record<string, unknown>>; note?: string } {
  // Paris wall-clock "now", comparable with the feed's local times.
  const paris = new Date(now.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace(" ", "T"));
  const active = new Map<string, Record<string, unknown>>();
  for (const d of data.disruptions || []) {
    const periods = (d.applicationPeriods as Array<{ begin?: string; end?: string }> | undefined) || [];
    const on = periods.find((p) => {
      const b = primDate(p.begin), e = primDate(p.end);
      return (!b || b <= paris) && (!e || e >= paris);
    });
    if (on) active.set(String(d.id), { ...d, _period: on });
  }
  const want = filter.line?.trim().toLowerCase().replace(/^(ligne|rer|metro|métro|tram|bus|transilien)\s+/i, "");
  const lines = (data.lines || []).filter((l) => {
    if (filter.mode && String(l.mode) !== filter.mode) return false;
    if (!want) return true;
    return String(l.shortName ?? "").toLowerCase() === want || String(l.name ?? "").toLowerCase() === want;
  });
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const l of lines) {
    for (const o of (l.impactedObjects as Array<{ type?: string; disruptionIds?: string[] }> | undefined) || []) {
      for (const id of o.disruptionIds || []) {
        const d = active.get(String(id));
        const k = `${l.id}|${id}`;
        if (!d || seen.has(k)) continue;
        seen.add(k);
        const p = d._period as { begin?: string; end?: string };
        out.push({
          line: l.shortName || l.name,
          mode: l.mode,
          severity: d.severity,
          cause: d.cause,
          title: d.title,
          message: plain(d.message).slice(0, 400),
          from: primDate(p.begin)?.toISOString().slice(0, 16).replace("T", " "),
          until: primDate(p.end)?.toISOString().slice(0, 16).replace("T", " "),
          scope: o.type,
        });
      }
    }
  }
  const rank = (s: unknown) => (s === "BLOQUANTE" ? 0 : s === "PERTURBEE" ? 1 : 2);
  out.sort((a, b) => rank(a.severity) - rank(b.severity));
  return {
    count: Math.min(out.length, filter.limit),
    lines_checked: lines.length,
    disruptions: out.slice(0, filter.limit),
    ...(want && lines.length === 0 ? { note: `No line named '${filter.line}' in the feed. Use the short name: 'L', 'A', '13', 'T2'.` } : {}),
    ...(lines.length > 0 && out.length === 0 ? { note: "No disruption in effect right now on the lines checked." } : {}),
  };
}
