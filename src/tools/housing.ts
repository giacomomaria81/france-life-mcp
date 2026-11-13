import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

interface Sale {
  date: string;
  price: number;
  type: string;
  surface: number | null;
  rooms: number | null;
  dwellings: number;
  land_m2: number | null;
  address: string;
  price_per_sqm: number | null;
  commune: string;
}

/** One CSV line into cells; DVF quotes a cell only when it holds a comma. */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * DVF writes one line per lot and per parcel: one sale spans several lines that all repeat the
 * total price. Group by sale, keep the dwellings (flats and houses) once each, ignore sales with
 * none (land, cellars, shops).
 */
export function dvfSales(csv: string): Sale[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = csvCells(lines[0]);
  const col = (name: string) => head.indexOf(name);
  const c = {
    id: col("id_mutation"), date: col("date_mutation"), nature: col("nature_mutation"), price: col("valeur_fonciere"),
    num: col("adresse_numero"), suffix: col("adresse_suffixe"), street: col("adresse_nom_voie"), cp: col("code_postal"),
    commune: col("nom_commune"), type: col("type_local"), surface: col("surface_reelle_bati"), rooms: col("nombre_pieces_principales"),
    land: col("surface_terrain"), parcel: col("id_parcelle"),
  };
  if (c.id < 0 || c.price < 0 || c.type < 0) return [];
  const groups = new Map<string, string[][]>();
  for (const line of lines.slice(1)) {
    const cells = csvCells(line);
    if (cells[c.nature] !== "Vente") continue;
    if (!groups.has(cells[c.id])) groups.set(cells[c.id], []);
    groups.get(cells[c.id])!.push(cells);
  }
  const sales: Sale[] = [];
  for (const rows of groups.values()) {
    const price = Number(rows[0][c.price]);
    if (!price) continue;
    const seen = new Set<string>();
    const homes = rows.filter((r) => (r[c.type] === "Appartement" || r[c.type] === "Maison") && Number(r[c.surface]) > 0).filter((r) => {
      const k = [r[c.type], r[c.surface], r[c.rooms], r[c.num], r[c.street]].join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (homes.length === 0) continue;
    const surface = homes.reduce((n, r) => n + Number(r[c.surface]), 0);
    const parcels = new Map<string, number>();
    for (const r of rows) if (r[c.parcel] && Number(r[c.land]) > 0) parcels.set(r[c.parcel], Math.max(parcels.get(r[c.parcel]) || 0, Number(r[c.land])));
    const land = [...parcels.values()].reduce((n, x) => n + x, 0);
    const h = homes[0];
    sales.push({
      date: h[c.date],
      price,
      type: homes.every((r) => r[c.type] === h[c.type]) ? h[c.type] : "Mixte",
      surface,
      rooms: homes.length === 1 ? Number(h[c.rooms]) || null : null,
      dwellings: homes.length,
      land_m2: land || null,
      address: `${[h[c.num], h[c.suffix], h[c.street]].filter(Boolean).join(" ")}, ${h[c.cp]} ${h[c.commune]}`.trim(),
      price_per_sqm: surface ? Math.round(price / surface) : null,
      commune: h[c.commune],
    });
  }
  return sales;
}

export function registerHousingTools(server: McpServer): void {
  server.registerTool(
    "france_get_property_prices",
    {
      title: "Get Property Prices (Real Transactions)",
      description: `Get real estate transaction prices from official government records (DVF).
These are actual sale prices registered by notaires, not estimates.

Use this when the user asks:
- "How much do apartments cost in Rueil-Malmaison?"
- "Property prices on my street"
- "Prix au m² dans le 15ème"

Returns the median price per m² (apartments and houses) over the last two published years,
then the most recent sales: date, price, type, surface, rooms, address, price per m².
DVF is published with a delay of several months.`,
      inputSchema: {
        commune_code: z.string().min(5).max(5)
          .describe("INSEE commune code (5 digits), e.g. '92063' for Rueil-Malmaison. Use france_search_address to find this (city_code field)."),
        limit: z.number().int().min(1).max(50).default(15).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      // Official per-commune DVF files (Etalab "geo-dvf"), one CSV per year. The Cerema API this tool
      // used before is no longer reachable; these static files are the published source.
      const dep = params.commune_code.startsWith("97") ? params.commune_code.slice(0, 3) : params.commune_code.slice(0, 2);
      const thisYear = new Date().getFullYear();
      const sales: Sale[] = [];
      const years: number[] = [];
      for (const year of [thisYear, thisYear - 1, thisYear - 2]) {
        if (years.length >= 2) break;
        try {
          const res = await fetch(`https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dep}/${params.commune_code}.csv`, {
            headers: { "User-Agent": "france-life-mcp/1.1.0" },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) continue;
          const found = dvfSales(await res.text());
          if (found.length === 0) continue;
          sales.push(...found);
          years.push(year);
        } catch {
          continue;
        }
      }
      if (sales.length === 0) {
        return toolResult({
          commune_code: params.commune_code,
          error: "No DVF sale found for this commune code (Alsace-Moselle and Mayotte are not in DVF), or the files are temporarily unavailable.",
          alternatives: {
            dvf_app: "https://app.dvf.etalab.gouv.fr/ — official interactive map of all property sales",
          },
        });
      }
      sales.sort((a, b) => b.date.localeCompare(a.date));
      const median = (xs: number[]) => {
        if (xs.length === 0) return null;
        const v = [...xs].sort((a, b) => a - b);
        return Math.round(v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
      };
      // A price per m² only means something for a sale of one single dwelling.
      const clean = (type: string) => sales.filter((x) => x.type === type && x.dwellings === 1 && x.price_per_sqm && x.price_per_sqm > 500 && x.price_per_sqm < 40000).map((x) => x.price_per_sqm as number);
      const flats = clean("Appartement");
      const houses = clean("Maison");
      return toolResult({
        commune_code: params.commune_code,
        commune: sales[0].commune,
        years_covered: years,
        total_sales: sales.length,
        median_price_per_sqm: {
          apartments: median(flats),
          apartments_sales_counted: flats.length,
          houses: median(houses),
          houses_sales_counted: houses.length,
        },
        count: Math.min(params.limit, sales.length),
        transactions: sales.slice(0, params.limit).map(({ commune, ...x }) => { void commune; return x; }),
        note: "DVF is published twice a year with a delay of several months: the most recent sales are not there yet. Medians count only sales of one single dwelling.",
        source: "DVF (Demandes de Valeurs Foncières), DGFiP — sales registered by notaires",
      });
    }
  );

  server.registerTool(
    "france_get_natural_risks",
    {
      title: "Get Natural & Technological Risks",
      description: `Get risk assessment for any commune in France — floods, earthquakes, landslides, industrial hazards, storms.
Uses the official Géorisques GASPAR API from the Ministry of Ecological Transition.

Use this when the user asks:
- "Is my area at risk of flooding?"
- "Risques naturels à Rueil-Malmaison"
- "Should I worry about earthquakes?"
- Important for property buyers

Returns: list of all identified risks for the commune with official classifications.`,
      inputSchema: {
        code_insee: z.string().min(5).max(5)
          .describe("INSEE commune code (5 digits), e.g. '92063' for Rueil-Malmaison. Use france_search_address to find this (city_code field)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        // Get identified risks
        const risksData = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://georisques.gouv.fr",
          path: "/api/v1/gaspar/risques",
          params: {
            code_insee: params.code_insee,
            page: 1,
            page_size: 50,
          },
          timeoutMs: 15000,
        });

        const dataArr = (risksData as { data: Array<Record<string, unknown>> }).data || [];
        const risks = dataArr.flatMap((d) => {
          const details = (d as { risques_detail: Array<{ libelle_risque_long: string; num_risque: string }> }).risques_detail || [];
          return details.map((r) => ({
            risk_code: r.num_risque,
            risk_name: r.libelle_risque_long,
          }));
        });

        // Also get natural disaster history (catnat)
        let catnatHistory: Array<Record<string, unknown>> = [];
        try {
          const catnatData = await apiFetch<Record<string, unknown>>({
            baseUrl: "https://georisques.gouv.fr",
            path: "/api/v1/gaspar/catnat",
            params: {
              code_insee: params.code_insee,
              page: 1,
              page_size: 10,
            },
            timeoutMs: 10000,
          });
          catnatHistory = ((catnatData as { data: Array<Record<string, unknown>> }).data || []).map((c) => ({
            type: c.libelle_risque_jo,
            start_date: c.dat_deb,
            end_date: c.dat_fin,
            decree_date: c.dat_pub_arrete,
          }));
        } catch {
          // catnat is bonus data, don't fail if unavailable
        }

        return toolResult({
          code_insee: params.code_insee,
          identified_risks: risks,
          risk_count: risks.length,
          recent_natural_disasters: catnatHistory,
          source: "Géorisques GASPAR — Ministère de la Transition Écologique",
          full_report: `https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi`,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "france_get_energy_rating",
    {
      title: "Get Building Energy Rating (DPE)",
      description: `Get energy performance data (DPE — Diagnostic de Performance Énergétique) for buildings.
Uses the ADEME DPE database.

Use this when the user asks:
- "What's the DPE rating of buildings in my area?"
- "Energy performance of apartments near me"
- "Passoires thermiques in Rueil-Malmaison?"

DPE scale: A (≤70 kWh/m²/year) = excellent, G (>450) = very poor.
F and G are "passoires thermiques". G is banned from new rentals since 2025, F from 2028.

Returns: how the commune's DPEs split across labels A to G, then the most recent DPEs
(rating, consumption, emissions, building type, heating).`,
      inputSchema: {
        commune_code: z.string().min(5).max(5).describe("INSEE commune code, e.g. '92063'"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        // ADEME replaced "dpe-v2-logements-existants" by "dpe03existant" (DPE issued since July 2021).
        const data = await apiFetch<{ results?: Array<Record<string, unknown>>; total?: number }>({
          baseUrl: "https://data.ademe.fr",
          path: "/data-fair/api/v1/datasets/dpe03existant/lines",
          params: {
            qs: `code_insee_ban:"${params.commune_code}"`,
            size: params.limit,
            sort: "-date_reception_dpe",
            select: "numero_dpe,etiquette_dpe,etiquette_ges,date_etablissement_dpe,date_reception_dpe,conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,type_batiment,surface_habitable_logement,periode_construction,type_energie_principale_chauffage,adresse_ban",
          },
          timeoutMs: 15000,
        });
        const results = data.results || [];
        if (results.length === 0) {
          return toolResult({
            commune_code: params.commune_code,
            error: "No DPE found for this commune code.",
            alternative: "Check https://observatoire-dpe-audit.ademe.fr/ for DPE statistics by commune.",
          });
        }
        // Share of each label across the whole commune, not only the rows shown.
        let distribution: Record<string, number> | null = null;
        try {
          const agg = await apiFetch<{ aggs?: Array<{ value: string; total: number }> }>({
            baseUrl: "https://data.ademe.fr",
            path: "/data-fair/api/v1/datasets/dpe03existant/values_agg",
            params: { field: "etiquette_dpe", qs: `code_insee_ban:"${params.commune_code}"`, agg_size: 10 },
            timeoutMs: 10000,
          });
          const rows = (agg.aggs || []).filter((a) => /^[A-G]$/.test(a.value)).sort((a, b) => a.value.localeCompare(b.value));
          if (rows.length) distribution = Object.fromEntries(rows.map((a) => [a.value, a.total]));
        } catch {
          // the distribution is a bonus
        }
        const total = data.total || 0;
        const poor = distribution ? (distribution.F || 0) + (distribution.G || 0) : null;
        return toolResult({
          commune_code: params.commune_code,
          total_dpes: total,
          rating_distribution: distribution,
          share_f_or_g_percent: poor !== null && total ? Math.round((poor / total) * 1000) / 10 : null,
          count: results.length,
          dpes: results.map((r) => ({
            dpe_number: r.numero_dpe,
            energy_rating: r.etiquette_dpe,
            ghg_rating: r.etiquette_ges,
            date: r.date_etablissement_dpe || r.date_reception_dpe,
            primary_energy_kwh_m2_year: r.conso_5_usages_par_m2_ep,
            ghg_kg_m2_year: r.emission_ges_5_usages_par_m2,
            building_type: r.type_batiment,
            surface_m2: r.surface_habitable_logement,
            built: r.periode_construction,
            heating: r.type_energie_principale_chauffage,
            address: r.adresse_ban,
          })),
          rating_scale: {
            A: "≤70 kWh/m²/year — Excellent",
            B: "71-110 — Very good",
            C: "111-180 — Good",
            D: "181-250 — Average",
            E: "251-330 — Poor",
            F: "331-420 — Very poor (rental ban from 2028)",
            G: ">420 — Extremely poor (rental ban since 2025)",
          },
          source: "ADEME — DPE logements existants (depuis juillet 2021)",
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
