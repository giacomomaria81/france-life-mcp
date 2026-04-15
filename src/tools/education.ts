import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

export function registerEducationTools(server: McpServer): void {
  server.registerTool(
    "france_search_schools",
    {
      title: "Search Schools in France",
      description: `Find schools (écoles, collèges, lycées) anywhere in France.
Uses the Annuaire de l'Éducation Nationale.

School types in the API:
- "Ecole" = covers both maternelle AND élémentaire (primary schools)
- "Collège" = middle school (11-15 years)
- "Lycée" = high school (15-18 years)
Note: there is no separate "maternelle" or "élémentaire" filter — both are "Ecole".

Use this when the user asks:
- "Find primary schools near me" → use type "Ecole"
- "Liste des collèges à Paris 15e"
- "Find a lycée with European section"`,
      inputSchema: {
        city: z.string().optional().describe("City name, e.g. 'Rueil-Malmaison'"),
        postcode: z.string().optional().describe("Postal code, e.g. '92500'"),
        school_type: z.enum(["Ecole", "Collège", "Lycée"]).optional()
          .describe("School level: 'Ecole' (maternelle+élémentaire), 'Collège', or 'Lycée'"),
        status: z.enum(["Public", "Privé"]).optional().describe("Public or private"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const whereClauses: string[] = [];
        if (params.city) whereClauses.push(`nom_commune LIKE "${params.city}"`);
        if (params.postcode) whereClauses.push(`code_postal = "${params.postcode}"`);
        if (params.school_type) whereClauses.push(`type_etablissement = "${params.school_type}"`);
        if (params.status) whereClauses.push(`statut_public_prive = "${params.status}"`);

        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://data.education.gouv.fr",
          path: "/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records",
          params: {
            where: whereClauses.length > 0 ? whereClauses.join(" AND ") : undefined,
            limit: params.limit,
            order_by: "nom_etablissement",
          },
        });

        const results = (data as { results: Array<Record<string, unknown>>; total_count: number }).results || [];
        const totalCount = (data as { total_count: number }).total_count || 0;

        const schools = results.map((r) => ({
          name: r.nom_etablissement,
          type: r.type_etablissement,
          status: r.statut_public_prive,
          address: r.adresse_1,
          postcode: r.code_postal,
          city: r.nom_commune,
          phone: r.telephone,
          email: r.mail,
          website: r.web,
          latitude: r.latitude,
          longitude: r.longitude,
        }));

        return toolResult({
          query: { city: params.city, postcode: params.postcode, type: params.school_type },
          total_count: totalCount,
          count: schools.length,
          schools,
          tip: "Type 'Ecole' covers both maternelle and élémentaire. Check the school name to distinguish (e.g. 'Ecole maternelle...' vs 'Ecole élémentaire...').",
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
