#!/usr/bin/env node

/**
 * France Life MCP — The first comprehensive MCP for daily life in France.
 *
 * 20 tools across 10 domains: weather, health, transport, schools, admin,
 * housing, calendar, address, prices, and business.
 *
 * All powered by free French government APIs + Open-Meteo.
 *
 * Author: Giacomo Pilia <giacomomaria@gmail.com>
 * License: MIT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAddressTools } from "./tools/address.js";
import { registerWeatherTools } from "./tools/weather.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerEducationTools } from "./tools/education.js";
import { registerHealthTools } from "./tools/health.js";
import { registerTransportTools } from "./tools/transport.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerHousingTools } from "./tools/housing.js";
import { registerPricesTools } from "./tools/prices.js";
import { registerBusinessTools } from "./tools/business.js";

const server = new McpServer({
  name: "france-life-mcp",
  version: "1.0.0",
});

// Register all tool domains
registerAddressTools(server);     // 2 tools: search_address, reverse_geocode
registerWeatherTools(server);     // 3 tools: weather, air_quality, water_quality
registerCalendarTools(server);    // 2 tools: public_holidays, school_holidays
registerEducationTools(server);   // 1 tool:  search_schools
registerHealthTools(server);      // 2 tools: search_doctors, find_pharmacies
registerTransportTools(server);   // 2 tools: search_stations, transport_disruptions
registerAdminTools(server);       // 1 tool:  search_public_services
registerHousingTools(server);     // 3 tools: property_prices, natural_risks, energy_rating
registerPricesTools(server);      // 1 tool:  fuel_prices
registerBusinessTools(server);    // 1 tool:  search_companies

// Total: 18 tools across 10 domains

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🇫🇷 France Life MCP started — 18 tools ready");
  console.error("   Domains: address, weather, calendar, education, health, transport, admin, housing, prices, business");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
