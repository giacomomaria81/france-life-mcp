import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

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

Note: The DVF API availability varies. If the API is unavailable, the tool provides
direct links to the official DVF visualization tool.

Returns: sale date, price, property type, surface area, number of rooms, address.`,
      inputSchema: {
        commune_code: z.string().min(5).max(5)
          .describe("INSEE commune code (5 digits), e.g. '92063' for Rueil-Malmaison. Use france_search_address to find this (city_code field)."),
        limit: z.number().int().min(1).max(50).default(15).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      // Try multiple DVF API endpoints (they change frequently)
      const endpoints = [
        { base: "https://apidf.cerema.fr", path: "/dvf_opendata/mutations/", paramKey: "code_commune" },
        { base: "https://apidf-preprod.cerema.fr", path: "/dvf_opendata/mutations", paramKey: "code_commune" },
      ];

      for (const ep of endpoints) {
        try {
          const data = await apiFetch<Record<string, unknown>>({
            baseUrl: ep.base,
            path: ep.path,
            params: {
              [ep.paramKey]: params.commune_code,
              page_size: params.limit,
              ordering: "-date_mutation",
            },
            timeoutMs: 8000,
          });

          const results = (data as { results: Array<Record<string, unknown>>; count: number }).results || [];
          const totalCount = (data as { count: number }).count || 0;

          if (results.length > 0) {
            const transactions = results.map((r) => ({
              date: r.date_mutation,
              price: r.valeur_fonciere,
              type: r.type_local,
              surface: r.surface_reelle_bati,
              rooms: r.nombre_pieces_principales,
              address: `${r.adresse_numero || ""} ${r.adresse_nom_voie || ""}, ${r.code_postal || ""} ${r.nom_commune || ""}`.trim(),
              price_per_sqm: r.surface_reelle_bati && r.valeur_fonciere
                ? Math.round((r.valeur_fonciere as number) / (r.surface_reelle_bati as number))
                : null,
            }));

            return toolResult({
              commune_code: params.commune_code,
              total_transactions: totalCount,
              count: transactions.length,
              transactions,
              source: "DVF (Demandes de Valeurs Foncières) — official notaire-registered sales",
            });
          }
        } catch {
          continue; // Try next endpoint
        }
      }

      // All endpoints failed — provide fallback
      return toolResult({
        commune_code: params.commune_code,
        error: "The DVF API is currently unavailable. This happens periodically as the government updates the data.",
        alternatives: {
          dvf_app: `https://app.dvf.etalab.gouv.fr/ — official interactive map of all property sales`,
          meilleursagents: "https://www.meilleursagents.com — estimated prices by neighborhood",
          tip: "On the DVF app, you can search by address and see every transaction in the area.",
        },
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
E/F/G are "passoires thermiques". F banned from rental since 2025, G since 2028.

Returns: DPE ratings, energy consumption, GHG emissions, building type.`,
      inputSchema: {
        commune_code: z.string().min(5).max(5).describe("INSEE commune code, e.g. '92063'"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://data.ademe.fr",
          path: "/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines",
          params: {
            q_fields: "Code_INSEE_(BAN)",
            q: params.commune_code,
            size: params.limit,
            sort: "Date_réception_DPE:-1",
            select: "N°DPE,Etiquette_DPE,Etiquette_GES,Date_réception_DPE,Conso_5_usages_é_finale,Emission_GES_5_usages,Type_bâtiment,Surface_habitable_logement,Année_construction,Type_énergie_principale_chauffage",
          },
          timeoutMs: 15000,
        });

        const results = (data as { results: Array<Record<string, unknown>>; total: number }).results || [];
        const total = (data as { total: number }).total || 0;

        if (results.length === 0) {
          return toolResult({
            commune_code: params.commune_code,
            error: "No DPE data found. The ADEME API may be temporarily unavailable.",
            alternative: "Check https://observatoire-dpe.ademe.fr/ for DPE statistics by commune.",
          });
        }

        const dpes = results.map((r) => ({
          dpe_number: r["N°DPE"],
          energy_rating: r["Etiquette_DPE"],
          ghg_rating: r["Etiquette_GES"],
          date: r["Date_réception_DPE"],
          energy_kwh_m2: r["Conso_5_usages_é_finale"],
          ghg_kg_m2: r["Emission_GES_5_usages"],
          building_type: r["Type_bâtiment"],
          surface_m2: r["Surface_habitable_logement"],
          year_built: r["Année_construction"],
          heating: r["Type_énergie_principale_chauffage"],
        }));

        return toolResult({
          commune_code: params.commune_code,
          total_dpes: total,
          count: dpes.length,
          dpes,
          rating_scale: {
            A: "≤70 kWh — Excellent",
            B: "71-110 — Very good",
            C: "111-180 — Good",
            D: "181-250 — Average",
            E: "251-330 — Poor",
            F: "331-420 — Very poor (rental ban 2028)",
            G: ">420 — Extremely poor (rental ban 2025)",
          },
        });
      } catch (error) {
        return toolResult({
          commune_code: params.commune_code,
          error: "ADEME DPE API is currently unavailable.",
          alternative: "Check https://observatoire-dpe.ademe.fr/ for DPE data by commune.",
        });
      }
    }
  );
}
