/**
 * World of Agents - Phase 1 (Vertical Slice)
 * Minimal authoritative game server + WebSocket updates.
 *
 * - Single match, 2 heroes: Warrior vs Mage
 * - Server owns state and runs tick loop
 * - Client receives state + combat log via WS
 * - Client can request ability casts via WS
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = Number(process.env.TICK_RATE || 5); // ticks/sec (readable)
const BROADCAST_RATE = Number(process.env.BROADCAST_RATE || 5);

// -------------------- Game state --------------------

function nowIso() {
  return new Date().toISOString();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function createHero({ id, name, className, maxHp, maxMana, damage, manaRegen, ability }) {
  return {
    id,
    name,
    className,
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    manaRegen,
    damage,
    basicAttackCd: 0,
    ability: {
      ...ability,
      cdRemaining: 0,
    },
  };
}

function createMatch() {
  const warrior = createHero({
    id: "warrior",
    name: "Theron",
    className: "Warrior",
    maxHp: 140,
    maxMana: 60,
    damage: 10,
    manaRegen: 4,
    ability: {
      name: "Shield Slam",
      manaCost: 20,
      cooldown: 5, // ticks
      damage: 22,
    },
  });

  const mage = createHero({
    id: "mage",
    name: "Seraphina",
    className: "Mage",
    maxHp: 95,
    maxMana: 100,
    damage: 7,
    manaRegen: 6,
    ability: {
      name: "Fireball",
      manaCost: 30,
      cooldown: 4, // ticks
      damage: 28,
    },
  });

  return {
    matchId: `m_${Date.now()}`,
    createdAt: nowIso(),
    tick: 0,
    phase: "active", // active | ended
    heroes: {
      warrior,
      mage,
    },
    log: [],
    lastWinner: null,
    pendingActions: [],
  };
}

const match = createMatch();

function pushLog(entry) {
  match.log.push({
    t: match.tick,
    at: nowIso(),
    ...entry,
  });
  if (match.log.length > 80) match.log.shift();
}

function otherHeroId(id) {
  return id === "warrior" ? "mage" : "warrior";
}

function isAlive(hero) {
  return hero.hp > 0;
}

function resetMatch() {
  const prevWinner = match.lastWinner;
  const next = createMatch();
  // Keep same object reference to avoid WS broadcaster capturing old pointer.
  match.matchId = next.matchId;
  match.createdAt = next.createdAt;
  match.tick = 0;
  match.phase = "active";
  match.lastWinner = prevWinner;
  match.pendingActions = [];
  match.log = [];
  match.heroes.warrior = next.heroes.warrior;
  match.heroes.mage = next.heroes.mage;
  pushLog({ type: "system", msg: "A new duel begins." });
}

function snapshot() {
  const w = match.heroes.warrior;
  const m = match.heroes.mage;
  return {
    matchId: match.matchId,
    tick: match.tick,
    phase: match.phase,
    heroes: {
      warrior: publicHero(w),
      mage: publicHero(m),
    },
    log: match.log,
    lastWinner: match.lastWinner,
  };
}

function publicHero(h) {
  return {
    id: h.id,
    name: h.name,
    className: h.className,
    hp: h.hp,
    maxHp: h.maxHp,
    mana: h.mana,
    maxMana: h.maxMana,
    damage: h.damage,
    basicAttackCd: h.basicAttackCd,
    ability: {
      name: h.ability.name,
      manaCost: h.ability.manaCost,
      cooldown: h.ability.cooldown,
      damage: h.ability.damage,
      cdRemaining: h.ability.cdRemaining,
    },
    alive: isAlive(h),
  };
}

function applyDamage(attacker, defender, amount, source) {
  const dmg = Math.min(defender.hp, amount);
  defender.hp = clamp(defender.hp - amount, 0, defender.maxHp);
  pushLog({
    type: "damage",
    source,
    attacker: attacker.id,
    defender: defender.id,
    amount: dmg,
    defenderHp: defender.hp,
  });
}

function tryBasicAttack(attackerId) {
  const attacker = match.heroes[attackerId];
  const defender = match.heroes[otherHeroId(attackerId)];
  if (!isAlive(attacker) || !isAlive(defender)) return;
  if (attacker.basicAttackCd > 0) return;

  attacker.basicAttackCd = 1; // every tick at 5Hz feels active; keep simple
  applyDamage(attacker, defender, attacker.damage, "basic");
}

function canCast(hero) {
  return (
    match.phase === "active" &&
    isAlive(hero) &&
    hero.ability.cdRemaining === 0 &&
    hero.mana >= hero.ability.manaCost
  );
}

function castAbility(attackerId) {
  const attacker = match.heroes[attackerId];
  const defender = match.heroes[otherHeroId(attackerId)];
  if (!isAlive(attacker) || !isAlive(defender)) return { ok: false, reason: "dead" };
  if (!canCast(attacker)) return { ok: false, reason: "not_ready" };

  attacker.mana = clamp(attacker.mana - attacker.ability.manaCost, 0, attacker.maxMana);
  attacker.ability.cdRemaining = attacker.ability.cooldown;

  pushLog({
    type: "cast",
    caster: attacker.id,
    ability: attacker.ability.name,
    manaCost: attacker.ability.manaCost,
  });

  applyDamage(attacker, defender, attacker.ability.damage, "ability");
  return { ok: true };
}

function tick() {
  if (match.phase !== "active") return;

  match.tick++;

  const w = match.heroes.warrior;
  const m = match.heroes.mage;

  // regen mana
  for (const h of [w, m]) {
    if (!isAlive(h)) continue;
    h.mana = clamp(h.mana + h.manaRegen, 0, h.maxMana);
  }

  // cooldowns
  for (const h of [w, m]) {
    if (h.basicAttackCd > 0) h.basicAttackCd--;
    if (h.ability.cdRemaining > 0) h.ability.cdRemaining--;
  }

  // apply queued actions (at most 1 per hero per tick)
  const actions = match.pendingActions;
  match.pendingActions = [];
  const seen = new Set();
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const heroId = a.heroId;
    if (heroId !== "warrior" && heroId !== "mage") continue;
    if (seen.has(heroId)) continue;
    seen.add(heroId);
    if (a.type === "cast") castAbility(heroId);
  }

  // basic attacks
  tryBasicAttack("warrior");
  tryBasicAttack("mage");

  // win condition
  if (!isAlive(w) || !isAlive(m)) {
    const winner = isAlive(w) ? "warrior" : "mage";
    match.phase = "ended";
    match.lastWinner = winner;
    pushLog({ type: "system", msg: `Winner: ${winner.toUpperCase()}` });

    // auto-reset after short delay
    setTimeout(() => resetMatch(), 1200);
  }
}

setInterval(tick, Math.floor(1000 / TICK_RATE));

// -------------------- HTTP static --------------------

const publicDir = path.join(__dirname, "public");

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, text) {
  send(
    res,
    status,
    { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    text
  );
}

function safeResolvePublic(urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/\0/g, "");
  const joined = path.join(publicDir, decoded);
  if (!joined.startsWith(publicDir)) return null;
  return joined;
}

const server = http.createServer((req, res) => {
  if (!req.url) return sendText(res, 400, "Bad Request");
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/state") {
    const body = JSON.stringify(snapshot());
    return send(
      res,
      200,
      { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body
    );
  }

  if (req.method !== "GET") return sendText(res, 405, "Method Not Allowed");

  const target = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeResolvePublic(target);
  if (!filePath) return sendText(res, 403, "Forbidden");

  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, "Not Found");
    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : "application/octet-stream";
    return send(res, 200, { "Content-Type": type, "Cache-Control": "no-store" }, data);
  });
});

// -------------------- WebSocket --------------------

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", data: snapshot() }));

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    // Minimal input validation
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "cast" && (msg.heroId === "warrior" || msg.heroId === "mage")) {
      match.pendingActions.push({ type: "cast", heroId: msg.heroId });
    }
  });
});

setInterval(() => {
  const payload = JSON.stringify({ type: "state", data: snapshot() });
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}, Math.floor(1000 / BROADCAST_RATE));

server.listen(PORT, () => {
  console.log("World of Agents Phase 1 server running:");
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ws://localhost:${PORT}/ws`);
});
