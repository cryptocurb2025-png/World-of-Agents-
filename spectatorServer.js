/**
 * World of Agents - Bit 2
 * Minimal spectator server (single in-memory match)
 * - Runs the simulation loop continuously
 * - Exposes GET /api/state returning current game snapshot
 * - Serves ./public for a placeholder page
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { createAgent } from "./Agent.js";
import {
  createGameState,
  addHeroToGame,
  moveHeroToLane,
  getFullGameStatus,
} from "./GameState.js";
import { processTick } from "./CombatEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = Number(process.env.TICK_RATE || 10); // ticks/sec
const BROADCAST_RATE = Number(process.env.BROADCAST_RATE || 5); // updates/sec

// --- Game setup (single match) ---
const gameState = createGameState();

// Alliance
const warrior = createAgent("Theron the Ironclad", "WARRIOR");
const mage = createAgent("Seraphina the Arcane", "MAGE");

// Horde
const ranger = createAgent("Grommak the Hunter", "RANGER");
const healer = createAgent("Zul'jin the Wise", "HEALER");

addHeroToGame(gameState, warrior, "alliance", "top");
addHeroToGame(gameState, mage, "alliance", "mid");
addHeroToGame(gameState, ranger, "horde", "mid");
addHeroToGame(gameState, healer, "horde", "bot");

// Simple built-in rotations so the state changes
function maybeRotateHeroes() {
  if (gameState.tick === 0) return;
  if (gameState.tick % 15 !== 0) return;

  const lanes = ["top", "mid", "bot"];
  const randomLane = lanes[Math.floor(Math.random() * lanes.length)];

  if (warrior.hp > 0 && warrior.lane !== randomLane) {
    moveHeroToLane(gameState, warrior, randomLane);
  }
  if (ranger.hp > 0 && ranger.lane !== warrior.lane) {
    moveHeroToLane(gameState, ranger, warrior.lane);
  }
}

setInterval(() => {
  processTick(gameState);
  maybeRotateHeroes();
}, Math.floor(1000 / TICK_RATE));

// --- HTTP server ---
const publicDir = path.join(__dirname, "public");

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function safeResolvePublicPath(urlPath) {
  // Basic directory traversal protection.
  const decoded = decodeURIComponent(urlPath);
  const cleaned = decoded.replace(/\0/g, "");
  const joined = path.join(publicDir, cleaned);
  if (!joined.startsWith(publicDir)) return null;
  return joined;
}

const server = http.createServer((req, res) => {
  if (!req.url) return sendText(res, 400, "Bad Request");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/state") {
    return sendJson(res, 200, getFullGameStatus(gameState));
  }

  if (req.method !== "GET") {
    return sendText(res, 405, "Method Not Allowed");
  }

  // Serve placeholder spectator page
  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = safeResolvePublicPath(targetPath);
  if (!resolved) return sendText(res, 403, "Forbidden");

  fs.readFile(resolved, (err, data) => {
    if (err) {
      return sendText(res, 404, "Not Found");
    }

    const ext = path.extname(resolved).toLowerCase();
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

// --- WebSocket spectator stream ---
// We use a single WS server, broadcasting the latest snapshot at a fixed rate.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  // Send an initial snapshot immediately.
  ws.send(
    JSON.stringify({ type: "state", data: getFullGameStatus(gameState) })
  );
});

setInterval(() => {
  const payload = JSON.stringify({ type: "state", data: getFullGameStatus(gameState) });
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}, Math.floor(1000 / BROADCAST_RATE));

server.listen(PORT, () => {
  // Keep console output minimal for now.
  console.log(`World of Agents spectator server running:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/api/state`);
  console.log(`  ws://localhost:${PORT}/ws`);
});
