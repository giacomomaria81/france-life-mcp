import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

const WEATHER_BASE = "https://api.open-meteo.com";
const AIR_QUALITY_BASE = "https://air-quality-api.open-meteo.com";

export function registerWeatherTools(server: McpServer): void {
  server.registerTool(
    "france_get_weather",
    {
      title: "Get Weather Forecast",
      description: `Get weather forecast for any location in France — today + next 6 days.
Uses Open-Meteo, a free high-accuracy weather API.

Use this when the user asks:
- "What's the weather in Paris tomorrow?"
- "Will it rain this weekend in Lyon?"
- "Should I bring an umbrella today?"
- "What's the temperature in Marseille?"
- "Météo pour demain à Nice"

Returns: daily temperature (min/max), precipitation probability, rain amount, wind speed, UV index, sunrise/sunset.
Also returns current conditions: temperature, humidity, wind, apparent temperature.`,
      inputSchema: {
        latitude: z.number().min(41).max(51.5).describe("Latitude — use france_search_address to get this from a city name"),
        longitude: z.number().min(-5.5).max(10).describe("Longitude"),
        days: z.number().int().min(1).max(7).default(3).describe("Number of forecast days (1-7, default 3)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: WEATHER_BASE,
          path: "/v1/forecast",
          params: {
            latitude: params.latitude,
            longitude: params.longitude,
            forecast_days: params.days,
            current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m",
            daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset,weather_code",
            timezone: "Europe/Paris",
          },
        });

        return toolResult({
          location: { latitude: params.latitude, longitude: params.longitude },
          timezone: "Europe/Paris",
          current: data.current,
          daily: data.daily,
          daily_units: data.daily_units,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "france_get_air_quality",
    {
      title: "Get Air Quality & Pollen",
      description: `Get current air quality index and pollen levels for any location in France.
Uses Open-Meteo Air Quality API.

Use this when the user asks:
- "What's the air quality today?"
- "Is it safe for kids to play outside?"
- "Pollen levels in Paris?"
- "Should I avoid running outdoors today?"
- "Qualité de l'air à Rueil-Malmaison"

Returns: European AQI (1-5 scale), PM2.5, PM10, NO2, O3, pollen (grass, birch, alder, ragweed, olive).
AQI scale: 1=Good, 2=Fair, 3=Moderate, 4=Poor, 5=Very Poor.`,
      inputSchema: {
        latitude: z.number().min(41).max(51.5).describe("Latitude"),
        longitude: z.number().min(-5.5).max(10).describe("Longitude"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: AIR_QUALITY_BASE,
          path: "/v1/air-quality",
          params: {
            latitude: params.latitude,
            longitude: params.longitude,
            current: "european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
            timezone: "Europe/Paris",
          },
        });

        return toolResult({
          location: { latitude: params.latitude, longitude: params.longitude },
          current: data.current,
          current_units: data.current_units,
          aqi_scale: {
            "1": "Good — Air quality is satisfactory",
            "2": "Fair — Acceptable, but may affect very sensitive people",
            "3": "Moderate — Sensitive people may experience symptoms",
            "4": "Poor — Everyone may begin to experience health effects",
            "5": "Very Poor — Health alert, everyone should reduce outdoor activity",
          },
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "france_get_water_quality",
    {
      title: "Get Tap Water Quality",
      description: `Get tap water quality data for a French commune.
Uses data from the Ministère de la Santé via data.gouv.fr Hub'Eau API.

Use this when the user asks:
- "Is my tap water safe to drink?"
- "What's in my tap water in Paris?"
- "Qualité de l'eau à Rueil-Malmaison"
- "Should I filter my water?"

Returns: latest water quality test results including compliance status, contaminants tested, and whether the water meets standards.`,
      inputSchema: {
        commune_code: z.string().min(5).max(5).describe("INSEE commune code (5 digits), e.g. '92063' for Rueil-Malmaison. Use france_search_address to get this (city_code field)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        // Hub'Eau: one row per measured parameter; rows of the same sample share its conclusion.
        const data = await apiFetch<{ count?: number; data?: Array<Record<string, unknown>> }>({
          baseUrl: "https://hubeau.eaufrance.fr",
          path: "/api/v1/qualite_eau_potable/resultats_dis",
          params: {
            code_commune: params.commune_code,
            size: 200,
            sort: "desc",
            fields: "code_prelevement,date_prelevement,libelle_parametre,resultat_alphanumerique,libelle_unite,limite_qualite_parametre,reference_qualite_parametre,conclusion_conformite_prelevement,conformite_limites_bact_prelevement,conformite_limites_pc_prelevement,conformite_references_bact_prelevement,conformite_references_pc_prelevement,nom_commune,nom_distributeur,nom_uge",
          },
          timeoutMs: 15000,
        });
        const rows = data.data || [];
        if (rows.length === 0) {
          return toolResult({
            commune_code: params.commune_code,
            error: "No tap water analysis found for this commune code.",
            alternative: "https://sante.gouv.fr/sante-et-environnement/eaux/eau — official results by commune",
          });
        }
        const flag = (v: unknown) => (v === "C" ? "compliant" : v === "N" ? "NOT compliant" : v === "D" ? "compliant by derogation" : v === "S" ? "not checked" : v ?? null);
        const samples = new Map<string, Array<Record<string, unknown>>>();
        for (const r of rows) {
          const k = String(r.code_prelevement ?? r.date_prelevement);
          if (!samples.has(k)) samples.set(k, []);
          samples.get(k)!.push(r);
        }
        const wanted = /nitrates \(|chlore libre|chlore total|escherichia|ent[ée]rocoques|turbidit|ph |^ph$|conductivit|plomb|duret|titre hydrotim|temp[ée]rature de l'eau|pesticides|fluorures|aluminium|ammonium/i;
        const latest = [...samples.values()].slice(0, 3).map((rs) => ({
          date: String(rs[0].date_prelevement ?? "").slice(0, 10),
          conclusion: rs[0].conclusion_conformite_prelevement,
          bacteriological_limits: flag(rs[0].conformite_limites_bact_prelevement),
          chemical_limits: flag(rs[0].conformite_limites_pc_prelevement),
          bacteriological_references: flag(rs[0].conformite_references_bact_prelevement),
          chemical_references: flag(rs[0].conformite_references_pc_prelevement),
          measures: rs.filter((r) => wanted.test(String(r.libelle_parametre ?? ""))).slice(0, 14).map((r) => ({
            parameter: r.libelle_parametre,
            value: r.resultat_alphanumerique,
            unit: r.libelle_unite && r.libelle_unite !== "SANS OBJET" ? r.libelle_unite : null,
            limit: r.limite_qualite_parametre || r.reference_qualite_parametre || null,
          })),
        }));
        return toolResult({
          commune_code: params.commune_code,
          commune: rows[0].nom_commune,
          distributor: rows[0].nom_distributeur,
          network: rows[0].nom_uge,
          latest_sample_date: latest[0]?.date,
          latest_conclusion: latest[0]?.conclusion,
          samples: latest,
          total_results_on_record: data.count,
          source: "Hub'Eau — Ministère de la Santé, contrôle sanitaire de l'eau distribuée",
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
