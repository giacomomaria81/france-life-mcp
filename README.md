# 🇫🇷 France Life MCP

**The first comprehensive MCP server for daily life in France.**

18 AI-ready tools covering weather, health, transport, schools, admin, housing, and more — all powered by free French government APIs.

Built for AI assistants (Claude, GPT, Gemini, custom agents) that need to understand and navigate life in France.

## Why This Exists

French government APIs are **free but painful** — each has different auth, formats, pagination, and quirks. This MCP normalizes everything into clean, AI-friendly tool calls with rich descriptions that tell the AI exactly when and how to use each tool.

Whether you're an expat trying to find a pharmacy on Sunday night, a French family checking school holidays, or a developer building the next great France-focused app — this MCP has you covered.

## Quick Start

### With Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "france-life": {
      "command": "npx",
      "args": ["france-life-mcp"]
    }
  }
}
```

Restart Claude Desktop. You now have 18 France tools available.

### With npm (global install)

```bash
npm install -g france-life-mcp
france-life-mcp
```

### From source

```bash
git clone https://github.com/giacomopilia/france-life-mcp.git
cd france-life-mcp
npm install
npm run build
npm start
```

## Tools Reference

### 📍 Address & Location (2 tools)

| Tool | Description |
|------|-------------|
| `france_search_address` | Geocode any French address → GPS coordinates (BAN database, 25M+ addresses) |
| `france_reverse_geocode` | GPS coordinates → nearest French address |

### 🌦️ Weather & Environment (3 tools)

| Tool | Description |
|------|-------------|
| `france_get_weather` | Forecast: temperature, rain, wind, UV index — today + 6 days |
| `france_get_air_quality` | Air quality index (AQI 1-5), PM2.5, PM10, ozone, pollen levels |
| `france_get_water_quality` | Tap water quality by commune — contaminants, compliance status |

### 📅 Calendar & Holidays (2 tools)

| Tool | Description |
|------|-------------|
| `france_get_public_holidays` | All jours fériés for any year + automatic pont (bridge day) detection |
| `france_get_school_holidays` | Vacances scolaires by zone A/B/C for any academic year |

### 🏫 Education (1 tool)

| Tool | Description |
|------|-------------|
| `france_search_schools` | Find schools by city, level (maternelle→lycée), public/private |

### 🏥 Health (2 tools)

| Tool | Description |
|------|-------------|
| `france_search_doctors` | Find doctors & specialists — with sector info (1=no extra fees, 2=extra fees possible) |
| `france_find_pharmacies` | Find pharmacies near you + pharmacie de garde tips for nights/Sundays |

### 🚆 Transport (2 tools)

| Tool | Description |
|------|-------------|
| `france_search_stations` | Find SNCF train stations by name or city |
| `france_get_transport_disruptions` | Current transport status + links to real-time sources |

### 🏛️ Admin & Paperwork (1 tool)

| Tool | Description |
|------|-------------|
| `france_search_public_services` | Find any administration: mairie, préfecture, CAF, CPAM, tribunal — with hours |

### 🏠 Housing & Neighborhood (3 tools)

| Tool | Description |
|------|-------------|
| `france_get_property_prices` | Real transaction prices from notaire records (DVF) — not estimates |
| `france_get_natural_risks` | Flood, earthquake, industrial risks for any address (Géorisques) |
| `france_get_energy_rating` | Building energy performance (DPE A-G) with rental ban info |

### 💰 Prices (1 tool)

| Tool | Description |
|------|-------------|
| `france_get_fuel_prices` | Cheapest fuel near you — real-time government data |

### 🏢 Business (1 tool)

| Tool | Description |
|------|-------------|
| `france_search_companies` | Company lookup by name/SIRET/SIREN — official SIRENE database |

## Example Conversations

Once connected, just talk naturally to your AI assistant:

> **"Is there a pharmacie open near Rueil-Malmaison?"**
> → Uses `france_find_pharmacies` with postcode 92500

> **"When are the next school holidays? We're in zone C."**
> → Uses `france_get_school_holidays` for current academic year, zone C

> **"How much did apartments sell for on my street last year?"**
> → Uses `france_search_address` to get commune code, then `france_get_property_prices`

> **"Find a dermatologist in the 92 who doesn't charge extra fees"**
> → Uses `france_search_doctors` with specialty and department filters

> **"Should I take an umbrella tomorrow?"**
> → Uses `france_search_address` for coordinates, then `france_get_weather`

> **"Is this plumber legit? His company is called XYZ Plomberie"**
> → Uses `france_search_companies` to verify registration and active status

## Data Sources

All data comes from **official, free, public APIs**:

| Source | API | Tools |
|--------|-----|-------|
| Base Adresse Nationale (BAN) | api-adresse.data.gouv.fr | Address |
| Open-Meteo | api.open-meteo.com | Weather, Air Quality |
| Hub'Eau | hubeau.eaufrance.fr | Water Quality |
| Calendrier gouv.fr | calendrier.api.gouv.fr | Public Holidays |
| Éducation Nationale | data.education.gouv.fr | School Holidays, Schools |
| Assurance Maladie | data.ameli.fr | Doctors |
| FINESS | OpenDataSoft | Pharmacies |
| SNCF Open Data | ressources.data.sncf.com | Stations, Transport |
| Service-Public.fr | api-lannuaire.service-public.fr | Public Services |
| DVF / Cerema | apidf-preprod.cerema.fr | Property Prices |
| Géorisques | georisques.gouv.fr | Natural Risks |
| ADEME | data.ademe.fr | Energy Ratings (DPE) |
| Prix Carburants | data.economie.gouv.fr | Fuel Prices |
| Recherche Entreprises | recherche-entreprises.api.gouv.fr | Companies |

**No API keys required.** All these APIs are free and open. Rate limits are generous (typically 50 req/sec).

## Architecture

```
france-life-mcp/
├── src/
│   ├── index.ts              # Server entry point
│   ├── services/
│   │   └── api-client.ts     # Shared HTTP client with error handling
│   └── tools/
│       ├── address.ts        # BAN geocoding
│       ├── weather.ts        # Open-Meteo + Hub'Eau
│       ├── calendar.ts       # Holidays
│       ├── education.ts      # Schools
│       ├── health.ts         # Doctors + Pharmacies
│       ├── transport.ts      # SNCF stations
│       ├── admin.ts          # Public services
│       ├── housing.ts        # DVF + Géorisques + DPE
│       ├── prices.ts         # Fuel prices
│       └── business.ts       # SIRENE companies
├── dist/                     # Compiled JavaScript
├── package.json
├── tsconfig.json
├── LICENSE                   # MIT
└── README.md
```

## Roadmap

### v1.0 (Current) — 18 tools
Core daily life tools covering the essentials.

### v2.0 (Planned)
- 🎭 **Culture & Entertainment** — events, movies, museums (OpenAgenda integration)
- 🍽️ **Restaurants** — when a good free API becomes available
- ⚖️ **Legal / Légifrance** — simplified French law lookup (requires PISTE registration)
- 📬 **La Poste** — mail tracking, postal codes
- 📊 **INSEE** — demographics and statistics
- 🏥 **Pharmacies de garde** — real-time on-duty pharmacy status

## Contributing

PRs welcome! Especially for:
- New tool integrations (check the roadmap above)
- Better tool descriptions (these matter hugely for AI quality)
- Bug fixes and API endpoint updates
- Translations (tool descriptions in French)

## License

MIT — use it however you want. Built with ❤️ for everyone navigating life in France.

## Author

**Giacomo Pilia** — Italian expat in France, building AI tools for daily life.

Part of the [Angie](https://github.com/giacomopilia/angie) ecosystem — a personal AI assistant for life in France.
