#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SocialcalcMcpServer } from "./server.js";
import * as http from "http";
import * as fs from "fs/promises";
import * as path from "path";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getFilesRoot, resolveInside } from "./utils/paths.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

// The HTTP bridge is for local browser test UIs. It is off unless asked for.
//   --http or SOCIALCALC_HTTP=1       enable it
//   SOCIALCALC_PORT                   port (default 5002)
//   SOCIALCALC_HOST                   address to bind (default 127.0.0.1)
//   SOCIALCALC_HTTP_TOKEN             bearer token (a random one is generated and printed if unset)
//   SOCIALCALC_CORS_ORIGINS           comma-separated browser origins allowed to call it (default: none)
function httpBridgeConfig() {
  const flag = (process.env.SOCIALCALC_HTTP ?? "").toLowerCase();
  const enabled = process.argv.includes("--http") || ["1", "true", "yes"].includes(flag);
  const port = process.env.SOCIALCALC_PORT ? parseInt(process.env.SOCIALCALC_PORT, 10) : 5002;
  const host = process.env.SOCIALCALC_HOST?.trim() || "127.0.0.1";
  const configuredToken = process.env.SOCIALCALC_HTTP_TOKEN?.trim();
  const token = configuredToken || randomBytes(24).toString("base64url");
  const origins = (process.env.SOCIALCALC_CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return { enabled, port, host, token, generatedToken: !configuredToken, origins };
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, { isError: true, content: [{ type: "text", text: message }] });
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const type = (req.headers["content-type"] ?? "").toLowerCase();
    if (!type.startsWith("application/json")) {
      reject(Object.assign(new Error("Content-Type must be application/json"), { status: 415 }));
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(Object.assign(new Error("Body is not valid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function startHttpBridge(mcpServer: SocialcalcMcpServer, config: ReturnType<typeof httpBridgeConfig>) {
  const httpServer = http.createServer(async (req, res) => {
    // CORS: only origins listed in SOCIALCALC_CORS_ORIGINS get headers; default is none.
    const origin = req.headers.origin;
    if (origin && config.origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Every route needs the bearer token.
    const header = req.headers.authorization ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!supplied || !sameSecret(supplied, config.token)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendError(res, 401, "Unauthorized: send 'Authorization: Bearer <token>'.");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "GET" && url.pathname === "/tools") {
        sendJson(res, 200, { tools: mcpServer.listTools() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/call") {
        const { name, arguments: args } = await readJsonBody(req);
        if (!name) throw Object.assign(new Error("Missing tool name"), { status: 400 });
        sendJson(res, 200, await mcpServer.executeTool(name, args));
        return;
      }

      // Sync browser-side spreadsheet data to the local filesystem
      if (req.method === "POST" && url.pathname === "/sync") {
        const { workbookPath, mscData } = await readJsonBody(req);
        if (!workbookPath || !mscData) {
          throw Object.assign(new Error("Missing workbookPath or mscData in payload"), { status: 400 });
        }

        const ext = path.extname(String(workbookPath)).toLowerCase();
        if (ext !== ".json" && ext !== ".msc") {
          throw Object.assign(
            new Error(`Invalid file extension: '${workbookPath}'. Only .json and .msc workbook files are supported for synchronization.`),
            { status: 400 }
          );
        }

        const resolvedPath = resolveInside(String(workbookPath));
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        const dataToWrite = typeof mscData === "object" ? JSON.stringify(mscData, null, 2) : String(mscData);
        await fs.writeFile(resolvedPath, dataToWrite, "utf-8");

        sendJson(res, 200, { success: true, message: "Workbook synchronized successfully." });
        return;
      }

      // Read local workbook file data back to the browser
      if (req.method === "GET" && url.pathname === "/read-file") {
        const filePath = url.searchParams.get("path");
        if (!filePath) throw Object.assign(new Error("Missing path parameter"), { status: 400 });

        const ext = path.extname(filePath).toLowerCase();
        if (ext !== ".json" && ext !== ".msc") {
          throw Object.assign(
            new Error(`Invalid file extension: '${filePath}'. Only .json and .msc workbook files are supported.`),
            { status: 400 }
          );
        }

        const data = await fs.readFile(resolveInside(filePath), "utf-8");
        sendJson(res, 200, { success: true, data });
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (err: any) {
      sendError(res, err.status ?? 400, `HTTP Error: ${err.message}`);
    }
  });

  httpServer.on("error", (error: any) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[Warning] HTTP server port ${config.port} is already in use. The HTTP bridge could not start, but stdio transport is active.`);
    } else {
      console.error(`[Warning] HTTP server failed to start: ${error.message}`);
    }
  });

  httpServer.listen(config.port, config.host, () => {
    console.error(`HTTP bridge listening on http://${config.host}:${config.port} (bearer token required)`);
    if (config.generatedToken) {
      console.error(`HTTP bridge token: ${config.token}`);
    }
    if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) {
      console.error(`[Warning] HTTP bridge is bound to ${config.host}, which may be reachable from other machines.`);
    }
  });
}

async function main() {
  const mcpServer = new SocialcalcMcpServer();

  const config = httpBridgeConfig();
  if (config.enabled) {
    startHttpBridge(mcpServer, config);
  }

  // Stdio transport for AI clients
  const transport = new StdioServerTransport();
  await mcpServer.getServerInstance().connect(transport);
  console.error(`Socialcalc MCP Server running on stdio transport (files confined to ${getFilesRoot()})`);
}

main().catch((error) => {
  console.error("Fatal error starting Socialcalc MCP Server:", error);
  process.exit(1);
});
