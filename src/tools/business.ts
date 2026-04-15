import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

export function registerBusinessTools(server: McpServer): void {
  server.registerTool(
    "france_search_companies",
    {
      title: "Search French Companies",
      description: `Look up any company registered in France by name, SIRET, or SIREN number.
Uses the official Recherche Entreprises API (SIRENE database from INSEE).

Use this when the user asks:
- "Is this company legit?"
- "Find the SIRET of [company]"
- "Company info for SIREN 123456789"
- "Recherche entreprise Paris plombier"
- "Check if this artisan is registered"
- "Info about my employer's company"

Returns: company name, SIREN/SIRET, legal form, address, creation date, activity code (NAF/APE), number of employees, and whether the company is active.
Covers ALL registered entities: companies (SARL, SAS, SA), sole traders (auto-entrepreneur), associations.`,
      inputSchema: {
        query: z.string().min(2)
          .describe("Company name, SIREN (9 digits), or SIRET (14 digits). E.g. 'Anthropic' or '443061841'"),
        postcode: z.string().optional().describe("Filter by postal code"),
        department: z.string().optional().describe("Filter by department code, e.g. '92'"),
        limit: z.number().int().min(1).max(20).default(5).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const searchParams: Record<string, string | number | undefined> = {
          q: params.query,
          per_page: params.limit,
          page: 1,
        };
        if (params.postcode) searchParams.code_postal = params.postcode;
        if (params.department) searchParams.departement = params.department;

        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://recherche-entreprises.api.gouv.fr",
          path: "/search",
          params: searchParams,
        });

        const results = (data as { results: Array<Record<string, unknown>>; total_results: number }).results || [];
        const totalResults = (data as { total_results: number }).total_results || 0;

        const companies = results.map((r) => {
          const siege = r.siege as Record<string, unknown> | undefined;
          return {
            name: r.nom_complet,
            siren: r.siren,
            siret_siege: siege?.siret,
            legal_form: r.nature_juridique,
            activity_code_naf: r.activite_principale,
            activity_label: r.libelle_activite_principale,
            address: siege
              ? `${siege.numero_voie || ""} ${siege.type_voie || ""} ${siege.libelle_voie || ""}, ${siege.code_postal || ""} ${siege.libelle_commune || ""}`.trim()
              : null,
            creation_date: r.date_creation,
            is_active: r.etat_administratif === "A",
            employee_count: r.tranche_effectif_salarie,
            category: r.categorie_entreprise,
          };
        });

        return toolResult({
          query: params.query,
          total_results: totalResults,
          count: companies.length,
          companies,
          legal_form_guide: {
            "5710": "SAS (Société par Actions Simplifiée)",
            "5720": "SASU (SAS Unipersonnelle)",
            "5499": "SARL",
            "5498": "EURL",
            "1000": "Entrepreneur individuel / Auto-entrepreneur",
            "9220": "Association loi 1901",
          },
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
