#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
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

function createServer(): McpServer {
  const server = new McpServer({ name: "france-life-mcp", version: "1.0.0" });
  registerAddressTools(server);
  registerWeatherTools(server);
  registerCalendarTools(server);
  registerEducationTools(server);
  registerHealthTools(server);
  registerTransportTools(server);
  registerAdminTools(server);
  registerHousingTools(server);
  registerPricesTools(server);
  registerBusinessTools(server);
  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("France Life MCP started (stdio) — 18 tools ready");
}

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get('/health', (_req, res) => {
    res.json({ status: "ok", name: "france-life-mcp", version: "1.0.0", tools: 18 });
  });
  const port = parseInt(process.env.PORT || "3000");
  app.listen(port, '0.0.0.0', () => {
    console.error("France Life MCP started (HTTP) on port " + port);
  });
}

const transport = process.env.TRANSPORT || "stdio";
if (transport === "http") { runHTTP().catch(e => { console.error(e); process.exit(1); }); }
else { runStdio().catch(e => { console.error(e); process.exit(1); }); }
