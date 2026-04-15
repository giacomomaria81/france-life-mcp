import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiFetch, toolResult, toolError } from "../services/api-client.js";

interface ServiceRecord {
  nom?: string;
  pivot?: Array<{ type_service_local?: string; code_insee_commune?: string[] }>;
  adresse?: Array<{
    type_adresse?: string;
    numero_voie?: string;
    complement1?: string;
    service_distribution?: string;
    code_postal?: string;
    nom_commune?: string;
    longitude?: string;
    latitude?: string;
  }>;
  telephone?: Array<{ valeur?: string; description?: string }>;
  adresse_courriel?: string;
  site_internet?: Array<{ valeur?: string }>;
  plage_ouverture?: Array<{
    nom_jour_debut?: string;
    nom_jour_fin?: string;
    valeur_heure_debut_1?: string;
    valeur_heure_fin_1?: string;
    valeur_heure_debut_2?: string;
    valeur_heure_fin_2?: string;
  }>;
  [key: string]: unknown;
}

function parseAddress(adresses?: ServiceRecord["adresse"]): string | null {
  if (!adresses) return null;
  const addrList = Array.isArray(adresses) ? adresses : [adresses];
  if (!addrList.length) return null;
  const a = addrList[0];
  if (typeof a === "string") return a;
  return [a.numero_voie, a.code_postal, a.nom_commune].filter(Boolean).join(", ");
}

function parsePhone(phones?: ServiceRecord["telephone"]): string | null {
  if (!phones) return null;
  const phoneList = Array.isArray(phones) ? phones : [phones];
  if (!phoneList.length) return null;
  return phoneList
    .map((p) => (typeof p === "string" ? p : p.valeur))
    .filter(Boolean)
    .join(" / ");
}

function parseHours(hours?: ServiceRecord["plage_ouverture"]): string[] | null {
  if (!hours) return null;
  const hourList = Array.isArray(hours) ? hours : [];
  if (!hourList.length) return null;
  return hourList.map((h) => {
    const days = h.nom_jour_debut === h.nom_jour_fin
      ? h.nom_jour_debut
      : `${h.nom_jour_debut} - ${h.nom_jour_fin}`;
    const slot1 = h.valeur_heure_debut_1 && h.valeur_heure_fin_1
      ? `${h.valeur_heure_debut_1.slice(0, 5)}-${h.valeur_heure_fin_1.slice(0, 5)}`
      : "";
    const slot2 = h.valeur_heure_debut_2 && h.valeur_heure_fin_2
      ? ` et ${h.valeur_heure_debut_2.slice(0, 5)}-${h.valeur_heure_fin_2.slice(0, 5)}`
      : "";
    return `${days}: ${slot1}${slot2}`;
  }).filter((s) => s.length > 3);
}

function parseCoordinates(adresses?: ServiceRecord["adresse"]): { lat: number; lon: number } | null {
  if (!adresses) return null;
  const addrList = Array.isArray(adresses) ? adresses : [adresses];
  if (!addrList.length) return null;
  const a = addrList[0];
  if (typeof a === "string") return null;
  if (a.latitude && a.longitude) {
    return { lat: parseFloat(a.latitude), lon: parseFloat(a.longitude) };
  }
  return null;
}

export function registerAdminTools(server: McpServer): void {
  server.registerTool(
    "france_search_public_services",
    {
      title: "Find Public Services & Administrations",
      description: `Find any French public administration — mairie, préfecture, CAF, CPAM, tribunal, France Travail, etc.
Uses the official Annuaire de l'Administration (Service-Public.fr).

Use this when the user asks:
- "Where is my mairie?"
- "Find the CAF near me"
- "Opening hours of the préfecture des Hauts-de-Seine"
- "How to contact CPAM"
- "Horaires de la mairie de Rueil-Malmaison"

Returns: name, type, address, phone, email, website, opening hours, and coordinates.`,
      inputSchema: {
        query: z.string().describe("Search query, e.g. 'mairie Rueil-Malmaison' or 'CAF Hauts-de-Seine' or 'préfecture 92'"),
        limit: z.number().int().min(1).max(20).default(5).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const data = await apiFetch<Record<string, unknown>>({
          baseUrl: "https://api-lannuaire.service-public.fr",
          path: "/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records",
          params: {
            q: params.query,
            limit: params.limit,
          },
        });

        const results = (data as { results: ServiceRecord[]; total_count: number }).results || [];
        const totalCount = (data as { total_count: number }).total_count || 0;

        const services = results.map((r) => ({
          name: r.nom,
          type: r.pivot?.[0]?.type_service_local || null,
          address: parseAddress(r.adresse),
          phone: parsePhone(r.telephone),
          email: r.adresse_courriel || null,
          website: r.site_internet?.[0]?.valeur || null,
          opening_hours: parseHours(r.plage_ouverture),
          coordinates: parseCoordinates(r.adresse),
        }));

        return toolResult({
          query: params.query,
          total_count: totalCount,
          count: services.length,
          services,
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
